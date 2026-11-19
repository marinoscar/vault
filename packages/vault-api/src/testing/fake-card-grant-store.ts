import { randomUUID } from 'node:crypto';

import {
  CardGrantStore,
  isGrantLive,
  periodStart,
  type CardGrantRecord,
  type CardGrantRequestRecord,
  type CardGrantUsage,
  type CardReleaseOutcome,
  type NewCardGrant,
  type NewCardGrantRequest,
} from '../agent/card-grant-store';

/** One release in {@link InMemoryCardGrantStore}. */
export interface InMemoryCardRelease {
  grantId: string;
  secretId: string;
  amountMinor: number;
  currency: string;
  createdAt: Date;
}

/**
 * A {@link CardGrantStore} in memory, with the same rules as the Prisma one (a live grant per card
 * and merchant site, the period limit and the per-card daily cap checked before a release is
 * recorded). For package tests and a host without a database.
 *
 * @stability experimental
 */
export class InMemoryCardGrantStore extends CardGrantStore {
  readonly grants: CardGrantRecord[] = [];
  readonly requests: CardGrantRequestRecord[] = [];
  readonly releases: InMemoryCardRelease[] = [];

  /** Adds a grant directly (test setup); fills in id and timestamps. */
  seedGrant(input: Partial<CardGrantRecord> & Pick<CardGrantRecord, 'secretId' | 'userId' | 'merchantOrigin' | 'merchantSite'>): CardGrantRecord {
    const grant: CardGrantRecord = {
      id: randomUUID(),
      frameOrigins: [],
      maxAmountMinor: 10_000,
      currency: 'USD',
      period: null,
      periodMaxReleases: null,
      periodMaxAmountMinor: null,
      includeSecurityCode: false,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
      ...input,
    };
    this.grants.push(grant);
    return grant;
  }

  async listGrants(secretId: string): Promise<CardGrantRecord[]> {
    return this.grants.filter((g) => g.secretId === secretId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listUnrevokedGrants(secretIds: string[]): Promise<CardGrantRecord[]> {
    return this.grants.filter((g) => secretIds.includes(g.secretId) && !g.revokedAt);
  }

  async getGrant(id: string): Promise<CardGrantRecord | null> {
    return this.grants.find((g) => g.id === id) ?? null;
  }

  async createGrant(input: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists'> {
    if (this.grants.some((g) => g.secretId === input.secretId && g.merchantSite === input.merchantSite && isGrantLive(g, now))) {
      return 'exists';
    }
    const grant: CardGrantRecord = { ...input, id: randomUUID(), createdAt: now, revokedAt: null };
    this.grants.push(grant);
    return grant;
  }

  async revokeGrant(id: string, at: Date): Promise<void> {
    const grant = this.grants.find((g) => g.id === id);
    if (grant && !grant.revokedAt) grant.revokedAt = at;
  }

  async usage(grants: CardGrantRecord[], now: Date): Promise<Map<string, CardGrantUsage>> {
    const out = new Map<string, CardGrantUsage>();
    for (const grant of grants) {
      const since = periodStart(now, grant.period ?? 'day').getTime();
      const all = this.releases.filter((r) => r.grantId === grant.id);
      const inPeriod = all.filter((r) => r.createdAt.getTime() >= since);
      out.set(grant.id, {
        periodReleases: inPeriod.length,
        periodAmountMinor: inPeriod.reduce((sum, r) => sum + r.amountMinor, 0),
        totalReleases: all.length,
        lastReleasedAt: all.length ? all[all.length - 1]!.createdAt : null,
      });
    }
    return out;
  }

  async recordRelease(input: {
    grant: CardGrantRecord;
    amountMinor: number;
    currency: string;
    dailyCap: number;
    now: Date;
  }): Promise<CardReleaseOutcome> {
    const { grant, amountMinor, currency, dailyCap, now } = input;
    if (grant.period) {
      const since = periodStart(now, grant.period).getTime();
      const used = this.releases.filter((r) => r.grantId === grant.id && r.createdAt.getTime() >= since);
      if (grant.periodMaxReleases !== null && used.length + 1 > grant.periodMaxReleases) return { ok: false, reason: 'period_limit' };
      const total = used.reduce((sum, r) => sum + r.amountMinor, 0);
      if (grant.periodMaxAmountMinor !== null && total + amountMinor > grant.periodMaxAmountMinor) return { ok: false, reason: 'period_limit' };
    }
    const today = periodStart(now, 'day').getTime();
    if (this.releases.filter((r) => r.secretId === grant.secretId && r.createdAt.getTime() >= today).length + 1 > dailyCap) {
      return { ok: false, reason: 'daily_cap' };
    }
    const first = !this.releases.some((r) => r.grantId === grant.id);
    this.releases.push({ grantId: grant.id, secretId: grant.secretId, amountMinor, currency, createdAt: now });
    return { ok: true, first };
  }

  async findPendingRequest(secretId: string, merchantSite: string): Promise<CardGrantRequestRecord | null> {
    return this.requests.find((r) => r.secretId === secretId && r.merchantSite === merchantSite && r.status === 'pending') ?? null;
  }

  async createRequest(input: NewCardGrantRequest): Promise<CardGrantRequestRecord> {
    const request: CardGrantRequestRecord = {
      ...input,
      id: randomUUID(),
      status: 'pending',
      grantId: null,
      createdAt: new Date(),
      decidedAt: null,
    };
    this.requests.push(request);
    return request;
  }

  async listRequests(secretId: string, status?: CardGrantRequestRecord['status']): Promise<CardGrantRequestRecord[]> {
    return this.requests
      .filter((r) => r.secretId === secretId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getRequest(id: string): Promise<CardGrantRequestRecord | null> {
    return this.requests.find((r) => r.id === id) ?? null;
  }

  async approveRequest(id: string, grant: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists' | null> {
    const request = this.requests.find((r) => r.id === id);
    if (!request || request.status !== 'pending') return null;
    const created = await this.createGrant(grant, now);
    if (created === 'exists') return 'exists';
    request.status = 'approved';
    request.decidedAt = now;
    request.grantId = created.id;
    return created;
  }

  async declineRequest(id: string, at: Date): Promise<boolean> {
    const request = this.requests.find((r) => r.id === id);
    if (!request || request.status !== 'pending') return false;
    request.status = 'declined';
    request.decidedAt = at;
    return true;
  }
}
