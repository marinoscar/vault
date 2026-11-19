import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AGENT_ERROR_CODES,
  CARD_GRANT_AUDIT_ACTIONS,
  amountToMinor,
  minorToAmount,
  type CardGrant,
  type CardGrantRequest,
  type CardGrantRequestStatus,
  type createCardGrantSchema,
} from '@marinoscar/vault-contract/agent';
import { normalizeOrigin } from '@marinoscar/vault-contract/secrets';
import type { z } from 'zod';

import { VAULT_AUDIT, VAULT_PRISMA, type VaultAuditPort, type VaultPrismaClient } from '../ports';
import { merchantSiteOf } from './agent-cards.service';
import {
  CardGrantStore,
  isGrantLive,
  type CardGrantRecord,
  type CardGrantRequestRecord,
  type CardGrantUsage,
  type NewCardGrant,
} from './card-grant-store';

/** The parsed body of a grant create. @stability experimental */
export type CreateCardGrantInput = z.output<typeof createCardGrantSchema>;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * The owner's side of merchant grants (ADR-0003): list, create and revoke a card's grants, and
 * approve or decline the requests agents made. Only the card's owner (its creator) reaches a card
 * here; anyone else gets the same 404 as a missing card. The controller admits only a browser
 * session for writes (`OWNER_SESSION_REQUIRED`): no token can create, change or widen a grant.
 * Every write is audited (`secret.card_grant.*`, `secret.card_grant_request.*`) with ids, the
 * merchant, the limits and never a card value.
 *
 * @stability experimental
 */
@Injectable()
export class CardGrantsService {
  /** The clock; a test replaces it. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
    @Inject(CardGrantStore) private readonly store: CardGrantStore,
  ) {}

  /** The caller's own system Card `secretId`, or the one 404. */
  private async ownCard(userId: string, secretId: string): Promise<{ id: string; name: string }> {
    const card = await this.prisma.secret.findFirst({
      where: { id: secretId, createdById: userId, type: { name: 'Card', isSystem: true } },
      select: { id: true, name: true },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  private status(grant: CardGrantRecord, now: Date): CardGrant['status'] {
    if (grant.revokedAt) return 'revoked';
    return isGrantLive(grant, now) ? 'active' : 'expired';
  }

  private toWire(grant: CardGrantRecord, usage: CardGrantUsage | undefined, now: Date): CardGrant {
    return {
      id: grant.id,
      secretId: grant.secretId,
      merchantOrigin: grant.merchantOrigin,
      merchantSite: grant.merchantSite,
      frameOrigins: [...grant.frameOrigins],
      maxAmount: minorToAmount(grant.maxAmountMinor),
      currency: grant.currency,
      periodLimit: grant.period
        ? {
            period: grant.period,
            maxReleases: grant.periodMaxReleases,
            maxAmount: grant.periodMaxAmountMinor === null ? null : minorToAmount(grant.periodMaxAmountMinor),
          }
        : null,
      expiresAt: iso(grant.expiresAt),
      includeSecurityCode: grant.includeSecurityCode,
      status: this.status(grant, now),
      createdAt: grant.createdAt.toISOString(),
      revokedAt: iso(grant.revokedAt),
      usage: {
        periodReleases: usage?.periodReleases ?? 0,
        periodAmount: minorToAmount(usage?.periodAmountMinor ?? 0),
        totalReleases: usage?.totalReleases ?? 0,
        lastReleasedAt: iso(usage?.lastReleasedAt ?? null),
      },
    };
  }

  private async record(userId: string, action: string, secretId: string, meta: Record<string, unknown>): Promise<void> {
    await this.audit.record({
      actorUserId: userId,
      action,
      targetType: 'secret',
      targetId: secretId,
      meta: { secretId, credential: 'session', ...meta },
    });
  }

  /** `GET /api/secrets/:id/card-grants`: every grant of the card, active first, with its use. */
  async list(userId: string, secretId: string): Promise<CardGrant[]> {
    await this.ownCard(userId, secretId);
    const now = this.now();
    const grants = await this.store.listGrants(secretId);
    const usage = await this.store.usage(grants, now);
    const order = { active: 0, expired: 1, revoked: 2 } as const;
    return grants
      .map((grant) => this.toWire(grant, usage.get(grant.id), now))
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  }

  private normalizeGrant(userId: string, secretId: string, body: CreateCardGrantInput, now: Date): NewCardGrant {
    const merchantOrigin = normalizeOrigin(body.merchantOrigin);
    if (!merchantOrigin) throw new BadRequestException('merchantOrigin is not a valid https origin');
    const frames = new Set<string>();
    for (const raw of body.frameOrigins ?? []) {
      const frame = normalizeOrigin(raw);
      if (!frame) throw new BadRequestException('frameOrigins holds an invalid https origin');
      frames.add(frame);
    }
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) throw new BadRequestException('expiresAt must be in the future');
    const limit = body.periodLimit ?? null;
    return {
      secretId,
      userId,
      merchantOrigin,
      merchantSite: merchantSiteOf(merchantOrigin),
      frameOrigins: [...frames].sort(),
      maxAmountMinor: amountToMinor(body.maxAmount),
      currency: body.currency,
      period: limit?.period ?? null,
      periodMaxReleases: limit?.maxReleases ?? null,
      periodMaxAmountMinor: limit?.maxAmount !== undefined && limit !== null ? amountToMinor(limit.maxAmount) : null,
      includeSecurityCode: body.includeSecurityCode ?? false,
      expiresAt,
    };
  }

  private exists(): ConflictException {
    return new ConflictException({
      code: AGENT_ERROR_CODES.CARD_GRANT_EXISTS,
      message: 'This card already has a live grant for this merchant; revoke it first',
    });
  }

  private grantMeta(grant: CardGrantRecord): Record<string, unknown> {
    return {
      grantId: grant.id,
      origin: grant.merchantOrigin,
      merchantSite: grant.merchantSite,
      frameOrigins: grant.frameOrigins.length,
      amount: (grant.maxAmountMinor / 100).toFixed(2),
      currency: grant.currency,
      period: grant.period,
      includeSecurityCode: grant.includeSecurityCode,
      expiresAt: iso(grant.expiresAt),
    };
  }

  /** `POST /api/secrets/:id/card-grants`: a new grant (409 CARD_GRANT_EXISTS when the merchant already has a live one). */
  async create(userId: string, secretId: string, body: CreateCardGrantInput): Promise<CardGrant> {
    await this.ownCard(userId, secretId);
    const now = this.now();
    const created = await this.store.createGrant(this.normalizeGrant(userId, secretId, body, now), now);
    if (created === 'exists') throw this.exists();
    await this.record(userId, CARD_GRANT_AUDIT_ACTIONS.CREATE, secretId, this.grantMeta(created));
    return this.toWire(created, undefined, now);
  }

  /** `DELETE /api/secrets/:id/card-grants/:grantId`: revoke (idempotent). */
  async revoke(userId: string, secretId: string, grantId: string): Promise<CardGrant> {
    await this.ownCard(userId, secretId);
    const grant = await this.store.getGrant(grantId);
    if (!grant || grant.secretId !== secretId) throw new NotFoundException('Grant not found');
    const now = this.now();
    if (!grant.revokedAt) {
      await this.store.revokeGrant(grantId, now);
      await this.record(userId, CARD_GRANT_AUDIT_ACTIONS.REVOKE, secretId, this.grantMeta(grant));
    }
    const fresh = (await this.store.getGrant(grantId)) ?? { ...grant, revokedAt: now };
    return this.toWire(fresh, (await this.store.usage([fresh], now)).get(fresh.id), now);
  }

  private async clientNames(requests: CardGrantRequestRecord[]): Promise<Map<string, string>> {
    const ids = [...new Set(requests.map((r) => r.clientId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.oAuthClient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private requestToWire(request: CardGrantRequestRecord, names: Map<string, string>): CardGrantRequest {
    return {
      id: request.id,
      secretId: request.secretId,
      origin: request.origin,
      merchantSite: request.merchantSite,
      amount: minorToAmount(request.amountMinor),
      currency: request.currency,
      reason: request.reason,
      status: request.status,
      clientName: (request.clientId ? names.get(request.clientId) : null) ?? request.clientLabel ?? null,
      createdAt: request.createdAt.toISOString(),
      decidedAt: iso(request.decidedAt),
      grantId: request.grantId,
    };
  }

  /** `GET /api/secrets/:id/card-grant-requests`: the card's requests, newest first. */
  async listRequests(userId: string, secretId: string, status?: CardGrantRequestStatus): Promise<CardGrantRequest[]> {
    await this.ownCard(userId, secretId);
    const requests = await this.store.listRequests(secretId, status);
    const names = await this.clientNames(requests);
    return requests.map((request) => this.requestToWire(request, names));
  }

  private async ownRequest(userId: string, secretId: string, requestId: string): Promise<CardGrantRequestRecord> {
    await this.ownCard(userId, secretId);
    const request = await this.store.getRequest(requestId);
    if (!request || request.secretId !== secretId) throw new NotFoundException('Grant request not found');
    return request;
  }

  private notPending(): ConflictException {
    return new ConflictException({
      code: AGENT_ERROR_CODES.CARD_GRANT_REQUEST_NOT_PENDING,
      message: 'This request was already approved or declined',
    });
  }

  /**
   * `POST .../card-grant-requests/:requestId/approve`: creates EXACTLY the requested grant (that
   * merchant origin, the requested amount as the maximum, that currency; no period limit, no expiry,
   * no security code, no payment frames) and marks the request approved.
   */
  async approve(userId: string, secretId: string, requestId: string): Promise<{ request: CardGrantRequest; grant: CardGrant }> {
    const request = await this.ownRequest(userId, secretId, requestId);
    if (request.status !== 'pending') throw this.notPending();
    const now = this.now();
    const grant: NewCardGrant = {
      secretId,
      userId,
      merchantOrigin: request.origin,
      merchantSite: request.merchantSite,
      frameOrigins: [],
      maxAmountMinor: request.amountMinor,
      currency: request.currency,
      period: null,
      periodMaxReleases: null,
      periodMaxAmountMinor: null,
      includeSecurityCode: false,
      expiresAt: null,
    };
    const created = await this.store.approveRequest(requestId, grant, now);
    if (created === null) throw this.notPending();
    if (created === 'exists') throw this.exists();
    await this.record(userId, CARD_GRANT_AUDIT_ACTIONS.APPROVE, secretId, { requestId, ...this.grantMeta(created) });
    const fresh = (await this.store.getRequest(requestId)) ?? { ...request, status: 'approved' as const, grantId: created.id, decidedAt: now };
    return {
      request: this.requestToWire(fresh, await this.clientNames([fresh])),
      grant: this.toWire(created, undefined, now),
    };
  }

  /** `POST .../card-grant-requests/:requestId/decline`. */
  async decline(userId: string, secretId: string, requestId: string): Promise<CardGrantRequest> {
    const request = await this.ownRequest(userId, secretId, requestId);
    if (request.status !== 'pending') throw this.notPending();
    const now = this.now();
    if (!(await this.store.declineRequest(requestId, now))) throw this.notPending();
    await this.record(userId, CARD_GRANT_AUDIT_ACTIONS.DECLINE, secretId, {
      requestId,
      origin: request.origin,
      amount: (request.amountMinor / 100).toFixed(2),
      currency: request.currency,
    });
    const fresh = (await this.store.getRequest(requestId)) ?? { ...request, status: 'declined' as const, decidedAt: now };
    return this.requestToWire(fresh, await this.clientNames([fresh]));
  }
}
