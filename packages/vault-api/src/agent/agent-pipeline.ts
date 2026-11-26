import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { withResponseHeaders } from '@marinoscar/platform-api/core';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import {
  AGENT_ERROR_CODES,
  AGENT_SERVICE_KEY_PER_MINUTE,
  resolveAgentAccessSettings,
  type AgentAccessSettings,
} from '@marinoscar/vault-contract/agent';

import { VAULT_AUDIT, VAULT_SETTINGS, type VaultAuditPort, type VaultSettingsPort } from '../ports';
import { AgentRateLimiter } from './agent-rate-limiter';

/**
 * Who is calling the agent rules: the user, and either the HTTP request's credential or, for an
 * in-process host that embeds the packages, the host's label.
 *
 * - HTTP (`AgentController`, `AgentCardsController`): `credential` is the request's credential
 *   (`null` when there is none). It must be an `oat_` or `pat_` token; a browser session is refused
 *   with `403 AGENT_CREDENTIAL_REQUIRED`.
 * - In process (`AgentReleasePort`): `credential` is absent (`undefined`) and `clientLabel` names
 *   the embedding host or its app (audited as `credential: embedded`).
 *
 * @stability experimental
 */
export interface AgentCaller {
  userId: string;
  credential?: AuthCredentialInfo | null;
  clientLabel?: string;
}

/** How a call authenticated, as the audit row records it. @stability experimental */
export type AgentCallerKind = 'oauth' | 'pat' | 'embedded';

/** The rate-limit buckets of the agent API. @stability experimental */
export type AgentBucket = 'lookup' | 'fill' | 'totp' | 'write' | 'card_fill' | 'identity_fill' | 'service_key';

/** The extra kill switch a route sits behind, besides `agentAccess.enabled`. @stability experimental */
export type AgentGate = 'cards' | 'identity';

/**
 * What an audit row records about one call. Never a value, a number, a code or a password. Filled
 * in by the work as facts become known, so a late denial still records the item.
 *
 * @stability experimental
 */
export interface AgentAuditContext {
  secretId?: string;
  /** For the notifications only; never written to the audit row. */
  secretName?: string;
  field?: string;
  origin?: string | null;
  frameOrigin?: string | null;
  purpose?: string;
  /** A card call's amount in hundredths, recorded as a decimal string. */
  amountMinor?: number;
  currency?: string;
  extra?: Record<string, unknown>;
}

/** Hooks a route adds around its success audit row. @stability experimental */
export interface AgentRunHooks {
  /** Runs after the work, BEFORE the `ok` row is written (a check that reads the trail). */
  beforeAudit?: () => Promise<void>;
  /** Runs after the `ok` row is written: notifications. Must not throw. */
  afterAudit?: () => Promise<void>;
  /** Runs after a denial was audited, with its reason. Must not throw. */
  onDenied?: (reason: string) => Promise<void>;
}

/** The options of one {@link AgentCallPipeline.run}. @stability experimental */
export interface AgentRunOptions {
  action: string;
  bucket: AgentBucket;
  gate?: AgentGate;
  /**
   * What the bucket counts per, instead of the default (the token, grant or host label, and the
   * user). The service-key bucket counts per owner and service, whoever calls (issue #241).
   */
  limitKey?: string;
}

const CODE_REASONS: Record<string, string> = {
  [AGENT_ERROR_CODES.ORIGIN_MISMATCH]: 'origin_mismatch',
  [AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED]: 'disabled',
  [AGENT_ERROR_CODES.AGENT_CREDENTIAL_REQUIRED]: 'credential_kind',
  [AGENT_ERROR_CODES.RATE_LIMITED]: 'rate_limited',
  [AGENT_ERROR_CODES.CARD_ACCESS_DISABLED]: 'cards_disabled',
  [AGENT_ERROR_CODES.IDENTITY_ACCESS_DISABLED]: 'identity_disabled',
  [AGENT_ERROR_CODES.SECURITY_CODE_NOT_GRANTED]: 'security_code_not_granted',
  [AGENT_ERROR_CODES.CARD_AMOUNT_EXCEEDED]: 'amount_exceeded',
  [AGENT_ERROR_CODES.CARD_CURRENCY_MISMATCH]: 'currency_mismatch',
  [AGENT_ERROR_CODES.CARD_PERIOD_LIMIT_REACHED]: 'period_limit',
  [AGENT_ERROR_CODES.CARD_DAILY_CAP_REACHED]: 'daily_cap',
  [AGENT_ERROR_CODES.CARD_GRANT_EXPIRED]: 'grant_expired',
  [AGENT_ERROR_CODES.SERVICE_KEY_AMBIGUOUS]: 'ambiguous',
};

/**
 * The machine-readable reason of a refusal, for the audit row's `denied:<reason>`.
 *
 * @stability experimental
 */
export function agentDenialReason(error: unknown): string {
  if (!(error instanceof HttpException)) return 'error';
  const body = error.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && CODE_REASONS[code]) return CODE_REASONS[code];
  switch (error.getStatus()) {
    case 400:
      return 'invalid';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    default:
      return 'error';
  }
}

const BUCKET_LIMIT: Record<AgentBucket, (s: AgentAccessSettings) => number> = {
  lookup: (s) => s.lookupPerMinute,
  fill: (s) => s.fillPerMinute,
  totp: (s) => s.totpPerMinute,
  write: (s) => s.writePerMinute,
  card_fill: (s) => s.cards.fillPerMinute,
  identity_fill: (s) => s.identity.fillPerMinute,
  service_key: () => AGENT_SERVICE_KEY_PER_MINUTE,
};

/** Throws a coded 403. @stability experimental */
export function agentForbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ code, message });
}

/**
 * The pipeline every agent call runs through, on HTTP and in process alike (ADR-0002, ADR-0003):
 * the caller's kind (an `oat_` or `pat_` token, or an in-process host; never a browser session),
 * the deployment kill switch `agentAccess.enabled`, the route's own switch (`cards`, `identity`),
 * the per-(token or grant or host, user) rate limit, then the work, then exactly one audit row
 * (`ok` or `denied:<reason>`). A success is audited BEFORE its value is returned, so an unwritable
 * trail fails the call closed; a denial is audited best effort so the refusal itself is not masked.
 *
 * @stability experimental
 */
@Injectable()
export class AgentCallPipeline {
  private readonly logger = new Logger(AgentCallPipeline.name);

  constructor(
    private readonly limiter: AgentRateLimiter,
    @Inject(VAULT_SETTINGS) private readonly settings: VaultSettingsPort,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
  ) {}

  /** The deployment's `agentAccess` settings, nested blocks merged over the defaults. */
  async loadSettings(): Promise<AgentAccessSettings> {
    return resolveAgentAccessSettings(await this.settings.getNamespace<unknown>('agentAccess'));
  }

  private disabled(): ForbiddenException {
    return agentForbidden(AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED, 'Agent access is switched off');
  }

  /** Kill switch only (whoami): no credential restriction, no rate limit, no audit. */
  async assertEnabled(): Promise<void> {
    if (!(await this.loadSettings()).enabled) throw this.disabled();
  }

  /** The caller's kind, or a 403 for a browser session, a node credential or an unlabelled in-process call. */
  callerKind(caller: AgentCaller): AgentCallerKind {
    if (caller.credential === undefined) {
      if (typeof caller.clientLabel === 'string' && caller.clientLabel.trim() !== '') return 'embedded';
    } else {
      const kind = caller.credential?.kind;
      if (kind === 'oauth' || kind === 'pat') return kind;
    }
    throw agentForbidden(
      AGENT_ERROR_CODES.AGENT_CREDENTIAL_REQUIRED,
      'The agent API accepts only an OAuth access token or a personal access token',
    );
  }

  /** The rate-limit principal: the OAuth grant, the PAT or the in-process host label. */
  principalKey(caller: AgentCaller): string {
    const credential = caller.credential;
    if (credential?.kind === 'oauth') return `oauth:${credential.grantId}`;
    if (credential?.kind === 'pat') return `pat:${credential.tokenId}`;
    if (credential === undefined && caller.clientLabel) return `embedded:${caller.clientLabel.trim()}`;
    return 'other';
  }

  /** The identity fields of an audit row's meta: never a value. */
  callerMeta(caller: AgentCaller): Record<string, unknown> {
    const credential = caller.credential;
    if (credential === undefined) {
      return { credential: 'embedded', clientLabel: caller.clientLabel?.trim() ?? null };
    }
    return {
      credential: credential?.kind ?? null,
      ...(credential?.kind === 'oauth' ? { clientId: credential.clientId, grantId: credential.grantId } : {}),
      ...(credential?.kind === 'pat' ? { tokenId: credential.tokenId } : {}),
    };
  }

  private auditMeta(caller: AgentCaller, ctx: AgentAuditContext, result: string): Record<string, unknown> {
    return {
      result,
      ...this.callerMeta(caller),
      secretId: ctx.secretId ?? null,
      field: ctx.field ?? null,
      origin: ctx.origin ?? null,
      purpose: ctx.purpose ?? null,
      ...(ctx.frameOrigin ? { frameOrigin: ctx.frameOrigin } : {}),
      ...(ctx.amountMinor !== undefined ? { amount: (ctx.amountMinor / 100).toFixed(2), currency: ctx.currency ?? null } : {}),
      ...(ctx.extra ?? {}),
    };
  }

  private async writeAudit(caller: AgentCaller, action: string, ctx: AgentAuditContext, result: string): Promise<void> {
    await this.audit.record({
      actorUserId: caller.userId,
      action,
      targetType: ctx.secretId ? 'secret' : 'user',
      targetId: ctx.secretId ?? caller.userId,
      meta: this.auditMeta(caller, ctx, result),
    });
  }

  /** Runs `work` inside the pipeline (see the class comment). */
  async run<T>(
    caller: AgentCaller,
    options: AgentRunOptions,
    ctx: AgentAuditContext,
    work: () => Promise<T>,
    hooks: AgentRunHooks = {},
  ): Promise<T> {
    let result: T;
    try {
      this.callerKind(caller);
      const settings = await this.loadSettings();
      if (!settings.enabled) throw this.disabled();
      if (options.gate === 'cards' && !settings.cards.enabled) {
        throw agentForbidden(AGENT_ERROR_CODES.CARD_ACCESS_DISABLED, 'Card release to agents is switched off');
      }
      if (options.gate === 'identity' && !settings.identity.enabled) {
        throw agentForbidden(AGENT_ERROR_CODES.IDENTITY_ACCESS_DISABLED, 'Identity release to agents is switched off');
      }
      const decision = this.limiter.consume(
        options.limitKey !== undefined
          ? `${options.bucket}:${options.limitKey}`
          : `${options.bucket}:${this.principalKey(caller)}:${caller.userId}`,
        BUCKET_LIMIT[options.bucket](settings),
      );
      if (!decision.allowed) {
        throw withResponseHeaders(
          new HttpException(
            { code: AGENT_ERROR_CODES.RATE_LIMITED, message: 'Too many agent requests; retry later' },
            HttpStatus.TOO_MANY_REQUESTS,
          ),
          { 'Retry-After': String(decision.retryAfterSeconds) },
        );
      }
      result = await work();
    } catch (error) {
      const reason = agentDenialReason(error);
      try {
        await this.writeAudit(caller, options.action, ctx, `denied:${reason}`);
      } catch (auditError) {
        this.logger.error(`Agent audit write failed for ${options.action}: ${(auditError as Error).name}`);
      }
      if (hooks.onDenied) {
        try {
          await hooks.onDenied(reason);
        } catch (hookError) {
          this.logger.warn(`Agent denial hook failed for ${options.action}: ${(hookError as Error)?.name}`);
        }
      }
      throw error;
    }
    if (hooks.beforeAudit) await hooks.beforeAudit();
    await this.writeAudit(caller, options.action, ctx, 'ok');
    if (hooks.afterAudit) await hooks.afterAudit();
    return result;
  }
}
