import { Inject, Injectable } from '@nestjs/common';

import { VAULT_PRISMA, type VaultPrismaClient } from '../ports';

/** A grant's period: a UTC calendar day or month. @stability experimental */
export type CardGrantPeriod = 'day' | 'month';

/** One merchant grant as stored (`agent_card_grants`). Amounts in hundredths. @stability experimental */
export interface CardGrantRecord {
  id: string;
  secretId: string;
  userId: string;
  merchantOrigin: string;
  merchantSite: string;
  frameOrigins: string[];
  maxAmountMinor: number;
  currency: string;
  period: CardGrantPeriod | null;
  periodMaxReleases: number | null;
  periodMaxAmountMinor: number | null;
  includeSecurityCode: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** What a new grant is made of. @stability experimental */
export type NewCardGrant = Omit<CardGrantRecord, 'id' | 'createdAt' | 'revokedAt'>;

/** One grant request as stored (`agent_card_grant_requests`). Never card data. @stability experimental */
export interface CardGrantRequestRecord {
  id: string;
  secretId: string;
  userId: string;
  origin: string;
  merchantSite: string;
  amountMinor: number;
  currency: string;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  clientId: string | null;
  clientLabel: string | null;
  grantId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/** What a new grant request is made of. @stability experimental */
export type NewCardGrantRequest = Omit<CardGrantRequestRecord, 'id' | 'status' | 'grantId' | 'createdAt' | 'decidedAt'>;

/** A grant's use. @stability experimental */
export interface CardGrantUsage {
  periodReleases: number;
  periodAmountMinor: number;
  totalReleases: number;
  lastReleasedAt: Date | null;
}

/** The answer of {@link CardGrantStore.recordRelease}. @stability experimental */
export type CardReleaseOutcome = { ok: true; first: boolean } | { ok: false; reason: 'period_limit' | 'daily_cap' };

/**
 * The start of the UTC calendar `period` that holds `now`.
 *
 * @stability experimental
 */
export function periodStart(now: Date, period: CardGrantPeriod): Date {
  return period === 'month'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Whether a grant is live at `now`: not revoked and not past its expiry. @stability experimental */
export function isGrantLive(grant: Pick<CardGrantRecord, 'revokedAt' | 'expiresAt'>, now: Date): boolean {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > now.getTime());
}

/**
 * The storage of merchant grants, grant requests and the release ledger (ADR-0003). An abstract
 * class so it is the DI token: {@link PrismaCardGrantStore} is the default; a test or a host
 * without a database binds another (`@marinoscar/vault-api/testing` has an in-memory one).
 *
 * The two methods that enforce a limit (`createGrant`, `recordRelease`) are atomic: they hold a
 * row lock on the card while they check and write, so concurrent calls cannot both pass.
 *
 * @extensionPoint token
 * @stability experimental
 */
export abstract class CardGrantStore {
  /** Every grant of a card (revoked ones included), newest first. */
  abstract listGrants(secretId: string): Promise<CardGrantRecord[]>;
  /** The non-revoked grants of these cards. */
  abstract listUnrevokedGrants(secretIds: string[]): Promise<CardGrantRecord[]>;
  /** One grant by id. */
  abstract getGrant(id: string): Promise<CardGrantRecord | null>;
  /** Creates a grant unless the card already has a live one for the merchant site (`exists`). */
  abstract createGrant(input: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists'>;
  /** Marks a grant revoked (idempotent). */
  abstract revokeGrant(id: string, at: Date): Promise<void>;
  /** The use of each grant in its current period (a day when it has no period limit). */
  abstract usage(grants: CardGrantRecord[], now: Date): Promise<Map<string, CardGrantUsage>>;
  /**
   * Atomically checks the grant's period limit and the card's daily cap and records a release.
   * `first` is true when the grant had no release before.
   */
  abstract recordRelease(input: {
    grant: CardGrantRecord;
    amountMinor: number;
    currency: string;
    dailyCap: number;
    now: Date;
  }): Promise<CardReleaseOutcome>;
  /** The pending request of a card for a merchant site, if any. */
  abstract findPendingRequest(secretId: string, merchantSite: string): Promise<CardGrantRequestRecord | null>;
  /** Creates a pending request. */
  abstract createRequest(input: NewCardGrantRequest): Promise<CardGrantRequestRecord>;
  /** A card's requests, newest first, optionally of one status. */
  abstract listRequests(secretId: string, status?: CardGrantRequestRecord['status']): Promise<CardGrantRequestRecord[]>;
  /** One request by id. */
  abstract getRequest(id: string): Promise<CardGrantRequestRecord | null>;
  /**
   * Approves a pending request by creating `grant`: `null` when the request is no longer pending,
   * `exists` when the card already has a live grant for the site (the request stays pending).
   */
  abstract approveRequest(id: string, grant: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists' | null>;
  /** Declines a pending request; false when it is no longer pending. */
  abstract declineRequest(id: string, at: Date): Promise<boolean>;
}

type Tx = Pick<VaultPrismaClient, 'agentCardGrant' | 'agentCardGrantRequest' | 'agentCardRelease' | '$queryRaw'>;

const GRANT_SELECT = {
  id: true,
  secretId: true,
  userId: true,
  merchantOrigin: true,
  merchantSite: true,
  frameOrigins: true,
  maxAmountMinor: true,
  currency: true,
  period: true,
  periodMaxReleases: true,
  periodMaxAmountMinor: true,
  includeSecurityCode: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/**
 * The default {@link CardGrantStore}, over `agent_card_grants`, `agent_card_grant_requests` and
 * `agent_card_releases` (no row-level security: Vault content belongs to a user, like `secrets`).
 *
 * @stability experimental
 */
@Injectable()
export class PrismaCardGrantStore extends CardGrantStore {
  constructor(@Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient) {
    super();
  }

  private async lockCard(tx: Tx, secretId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM secrets WHERE id = ${secretId}::uuid FOR UPDATE`;
  }

  async listGrants(secretId: string): Promise<CardGrantRecord[]> {
    return (await this.prisma.agentCardGrant.findMany({
      where: { secretId },
      select: GRANT_SELECT,
      orderBy: { createdAt: 'desc' },
    })) as CardGrantRecord[];
  }

  async listUnrevokedGrants(secretIds: string[]): Promise<CardGrantRecord[]> {
    if (secretIds.length === 0) return [];
    return (await this.prisma.agentCardGrant.findMany({
      where: { secretId: { in: secretIds }, revokedAt: null },
      select: GRANT_SELECT,
    })) as CardGrantRecord[];
  }

  async getGrant(id: string): Promise<CardGrantRecord | null> {
    return (await this.prisma.agentCardGrant.findUnique({ where: { id }, select: GRANT_SELECT })) as CardGrantRecord | null;
  }

  private async createLocked(tx: Tx, input: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists'> {
    await this.lockCard(tx, input.secretId);
    const live = await tx.agentCardGrant.findFirst({
      where: {
        secretId: input.secretId,
        merchantSite: input.merchantSite,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (live) return 'exists';
    return (await tx.agentCardGrant.create({ data: input, select: GRANT_SELECT })) as CardGrantRecord;
  }

  async createGrant(input: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists'> {
    return this.prisma.$transaction((tx) => this.createLocked(tx as unknown as Tx, input, now));
  }

  async revokeGrant(id: string, at: Date): Promise<void> {
    await this.prisma.agentCardGrant.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
  }

  async usage(grants: CardGrantRecord[], now: Date): Promise<Map<string, CardGrantUsage>> {
    const out = new Map<string, CardGrantUsage>();
    for (const grant of grants) {
      const since = periodStart(now, grant.period ?? 'day');
      const [period, total, last] = await Promise.all([
        this.prisma.agentCardRelease.aggregate({
          where: { grantId: grant.id, createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { amountMinor: true },
        }),
        this.prisma.agentCardRelease.count({ where: { grantId: grant.id } }),
        this.prisma.agentCardRelease.findFirst({
          where: { grantId: grant.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);
      out.set(grant.id, {
        periodReleases: period._count._all,
        periodAmountMinor: period._sum.amountMinor ?? 0,
        totalReleases: total,
        lastReleasedAt: last?.createdAt ?? null,
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
    return this.prisma.$transaction(async (raw) => {
      const tx = raw as unknown as Tx;
      await this.lockCard(tx, grant.secretId);
      if (grant.period) {
        const since = periodStart(now, grant.period);
        const used = await tx.agentCardRelease.aggregate({
          where: { grantId: grant.id, createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { amountMinor: true },
        });
        if (grant.periodMaxReleases !== null && used._count._all + 1 > grant.periodMaxReleases) {
          return { ok: false, reason: 'period_limit' } as const;
        }
        if (grant.periodMaxAmountMinor !== null && (used._sum.amountMinor ?? 0) + amountMinor > grant.periodMaxAmountMinor) {
          return { ok: false, reason: 'period_limit' } as const;
        }
      }
      const today = await tx.agentCardRelease.count({
        where: { secretId: grant.secretId, createdAt: { gte: periodStart(now, 'day') } },
      });
      if (today + 1 > dailyCap) return { ok: false, reason: 'daily_cap' } as const;
      const prior = await tx.agentCardRelease.count({ where: { grantId: grant.id } });
      await tx.agentCardRelease.create({
        data: { grantId: grant.id, secretId: grant.secretId, amountMinor, currency, createdAt: now },
      });
      return { ok: true, first: prior === 0 } as const;
    });
  }

  async findPendingRequest(secretId: string, merchantSite: string): Promise<CardGrantRequestRecord | null> {
    return (await this.prisma.agentCardGrantRequest.findFirst({
      where: { secretId, merchantSite, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })) as CardGrantRequestRecord | null;
  }

  async createRequest(input: NewCardGrantRequest): Promise<CardGrantRequestRecord> {
    return (await this.prisma.agentCardGrantRequest.create({ data: input })) as CardGrantRequestRecord;
  }

  async listRequests(secretId: string, status?: CardGrantRequestRecord['status']): Promise<CardGrantRequestRecord[]> {
    return (await this.prisma.agentCardGrantRequest.findMany({
      where: { secretId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })) as CardGrantRequestRecord[];
  }

  async getRequest(id: string): Promise<CardGrantRequestRecord | null> {
    return (await this.prisma.agentCardGrantRequest.findUnique({ where: { id } })) as CardGrantRequestRecord | null;
  }

  async approveRequest(id: string, grant: NewCardGrant, now: Date): Promise<CardGrantRecord | 'exists' | null> {
    return this.prisma.$transaction(async (raw) => {
      const tx = raw as unknown as Tx;
      await this.lockCard(tx, grant.secretId);
      const request = await tx.agentCardGrantRequest.findUnique({ where: { id }, select: { status: true } });
      if (!request || request.status !== 'pending') return null;
      const created = await this.createLocked(tx, grant, now);
      if (created === 'exists') return 'exists';
      await tx.agentCardGrantRequest.update({
        where: { id },
        data: { status: 'approved', decidedAt: now, grantId: created.id },
      });
      return created;
    });
  }

  async declineRequest(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.agentCardGrantRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'declined', decidedAt: at },
    });
    return result.count > 0;
  }
}
