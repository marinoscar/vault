import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  BROKER_ERROR_CODES,
  BROKER_TOKEN_AUDIT_ACTIONS,
  BROKER_TOKEN_DISPLAY_PREFIX_LENGTH,
  BROKER_TOKEN_PREFIX,
  type BrokerToken,
  type CreateBrokerToken,
  type CreatedBrokerToken,
} from '@marinoscar/vault-contract/broker';

import { VAULT_AUDIT, VAULT_PRISMA, type VaultAuditPort, type VaultPrismaClient } from '../ports';
import { generateBrokerToken, hashBrokerToken } from './broker-token';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only thing `lastUsedAt` is throttled by: one write per token per minute. */
const LAST_USED_THROTTLE_MS = 60_000;

/** A broker token that authenticated a request: who and what it may reach. Never the token. */
export interface ResolvedBrokerToken {
  tokenId: string;
  userId: string;
  /** Empty means every broker-enabled secret of the owner. */
  secretIds: string[];
}

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  secretIds: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function present(row: TokenRow): BrokerToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    secretIds: row.secretIds ?? [],
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The broker token lifecycle (ADR-0006 decisions 1 and 2): create (the token is shown once, only its
 * SHA-256 is stored), list (never the token or its hash), revoke (owner only), and resolve a
 * presented `vbk_` token for the forwarding endpoint.
 *
 * @stability experimental
 */
@Injectable()
export class BrokerTokensService {
  private readonly logger = new Logger(BrokerTokensService.name);
  private readonly lastUsed = new Map<string, number>();

  /** The clock; a test replaces it. */
  now: () => number = () => Date.now();

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
  ) {}

  /** Creates a token for `userId`. A restriction must name only the caller's own broker-enabled secrets. */
  async create(userId: string, dto: CreateBrokerToken): Promise<CreatedBrokerToken> {
    const secretIds = [...new Set(dto.secretIds ?? [])];
    if (secretIds.length > 0) {
      const owned = await this.prisma.secret.count({ where: { id: { in: secretIds }, createdById: userId, brokerAccess: true } });
      if (owned !== secretIds.length) {
        throw new UnprocessableEntityException({
          code: BROKER_ERROR_CODES.BROKER_TOKEN_SECRET_INVALID,
          message: 'A broker token can be restricted only to your own secrets that have the broker switched on',
        });
      }
    }
    const token = generateBrokerToken();
    const expiresAt = new Date(this.now() + dto.expiresInDays * DAY_MS);
    const row = await this.prisma.brokerToken.create({
      data: {
        userId,
        name: dto.name,
        tokenHash: hashBrokerToken(token),
        tokenPrefix: token.slice(0, BROKER_TOKEN_DISPLAY_PREFIX_LENGTH),
        secretIds,
        expiresAt,
      },
    });
    // The token is never in the audit row: the name, the id and the restriction only.
    await this.audit.record({
      actorUserId: userId,
      action: BROKER_TOKEN_AUDIT_ACTIONS.CREATE,
      targetType: 'broker_token',
      targetId: row.id,
      meta: { tokenId: row.id, name: dto.name, expiresAt: expiresAt.toISOString(), secretIds },
    });
    return { ...present(row as TokenRow), token };
  }

  /** The caller's tokens, newest first. Never the token or its hash. */
  async list(userId: string): Promise<BrokerToken[]> {
    const rows = await this.prisma.brokerToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => present(row as TokenRow));
  }

  /** Revokes the caller's own token (idempotent). Foreign and missing tokens are both 404. */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const row = await this.prisma.brokerToken.findFirst({ where: { id: tokenId, userId } });
    if (!row) throw new NotFoundException('Broker token not found');
    if (row.revokedAt) return;
    await this.prisma.brokerToken.update({ where: { id: tokenId }, data: { revokedAt: new Date(this.now()) } });
    await this.audit.record({
      actorUserId: userId,
      action: BROKER_TOKEN_AUDIT_ACTIONS.REVOKE,
      targetType: 'broker_token',
      targetId: tokenId,
      meta: { tokenId, name: row.name },
    });
  }

  /**
   * The token a request presented, or `null` when it is unknown, revoked, expired, not shaped like a
   * broker token or its owner is inactive (one answer for all of them). Stamps `lastUsedAt` at most
   * once a minute per token; a failed stamp never fails the request.
   */
  async resolve(presented: string): Promise<ResolvedBrokerToken | null> {
    if (!presented.startsWith(BROKER_TOKEN_PREFIX)) return null;
    const row = await this.prisma.brokerToken.findUnique({
      where: { tokenHash: hashBrokerToken(presented) },
      include: { user: { select: { isActive: true } } },
    });
    if (!row || row.revokedAt || !row.user?.isActive) return null;
    const now = this.now();
    if (row.expiresAt && row.expiresAt.getTime() <= now) return null;
    const last = this.lastUsed.get(row.id) ?? 0;
    if (now - last >= LAST_USED_THROTTLE_MS) {
      this.lastUsed.set(row.id, now);
      if (this.lastUsed.size > 5_000) this.lastUsed.clear();
      this.prisma.brokerToken
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
        .catch((error: unknown) => this.logger.warn(`Broker token last-used stamp failed: ${(error as Error)?.name}`));
    }
    return { tokenId: row.id, userId: row.userId, secretIds: row.secretIds ?? [] };
  }
}
