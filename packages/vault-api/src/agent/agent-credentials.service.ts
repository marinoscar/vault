import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { withResponseHeaders } from '@marinoscar/platform-api/core';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import {
  AGENT_ACCESS_SETTINGS_DEFAULTS,
  AGENT_AUDIT_ACTIONS,
  AGENT_ERROR_CODES,
  type AgentAccessSettings,
  type AgentAuditAction,
  type AgentCreateCredentialRequest,
  type AgentCredentialSummary,
  type AgentFillRequest,
  type AgentRotatePasswordRequest,
  type AgentTotpRequest,
} from '@marinoscar/vault-contract/agent';
import { matchOrigin, normalizeOrigin } from '@marinoscar/vault-contract/secrets';

import { VAULT_AUDIT, VAULT_SETTINGS, type VaultAuditPort, type VaultSettingsPort } from '../ports';
import { SecretsService } from '../secrets/secrets.service';
import { AgentRateLimiter } from './agent-rate-limiter';
import { generatePassword } from './password-generator';

/** Most credentials one lookup returns. */
const MAX_LOOKUP_RESULTS = 25;

/** Who is calling: the user and how the request authenticated. */
export interface AgentCaller {
  userId: string;
  credential: AuthCredentialInfo | null;
}

type Bucket = 'lookup' | 'fill' | 'totp' | 'write';

/** What an audit row records about one call. Never a value, a code or a password. */
interface AuditContext {
  secretId?: string;
  field?: string;
  origin?: string | null;
  purpose?: string;
  extra?: Record<string, unknown>;
}

const BUCKET_SETTING: Record<Bucket, keyof AgentAccessSettings> = {
  lookup: 'lookupPerMinute',
  fill: 'fillPerMinute',
  totp: 'totpPerMinute',
  write: 'writePerMinute',
};

/** The machine-readable reason of a refusal, for the audit row's `denied:<reason>`. */
function denialReason(error: unknown): string {
  if (!(error instanceof HttpException)) return 'error';
  const body = error.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  if (code === AGENT_ERROR_CODES.ORIGIN_MISMATCH) return 'origin_mismatch';
  if (code === AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED) return 'disabled';
  if (code === AGENT_ERROR_CODES.AGENT_CREDENTIAL_REQUIRED) return 'credential_kind';
  if (code === AGENT_ERROR_CODES.RATE_LIMITED) return 'rate_limited';
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

/**
 * The agent credential API's behaviour (`/api/agent/v1`). Every call runs through one pipeline:
 * credential kind (`oat_` or `pat_`, never a browser session), the deployment kill switch, the
 * per-(token or grant, user) rate limit, then the work, then one audit row (`ok` or
 * `denied:<reason>`). Nothing sensitive reaches a log, a span, an error or an audit row. A secret
 * that is missing, foreign, not opened to agents or not a Credential is a plain 404.
 *
 * @stability experimental
 */
@Injectable()
export class AgentCredentialsService {
  private readonly logger = new Logger(AgentCredentialsService.name);

  constructor(
    private readonly secrets: SecretsService,
    private readonly limiter: AgentRateLimiter,
    @Inject(VAULT_SETTINGS) private readonly settings: VaultSettingsPort,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
  ) {}

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  private async loadSettings(): Promise<AgentAccessSettings> {
    const stored = await this.settings.getNamespace<Partial<AgentAccessSettings>>('agentAccess');
    return { ...AGENT_ACCESS_SETTINGS_DEFAULTS, ...(stored ?? {}) };
  }

  private disabled(): ForbiddenException {
    return new ForbiddenException({
      code: AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED,
      message: 'Agent access is switched off',
    });
  }

  /** Kill switch only (whoami): no credential restriction, no rate limit, no audit. */
  async assertEnabled(): Promise<void> {
    if (!(await this.loadSettings()).enabled) throw this.disabled();
  }

  private principalKey(caller: AgentCaller): string {
    const credential = caller.credential;
    if (credential?.kind === 'oauth') return `oauth:${credential.grantId}`;
    if (credential?.kind === 'pat') return `pat:${credential.tokenId}`;
    return 'other';
  }

  private auditMeta(caller: AgentCaller, ctx: AuditContext, result: string): Record<string, unknown> {
    const credential = caller.credential;
    return {
      result,
      credential: credential?.kind ?? null,
      ...(credential?.kind === 'oauth' ? { clientId: credential.clientId, grantId: credential.grantId } : {}),
      ...(credential?.kind === 'pat' ? { tokenId: credential.tokenId } : {}),
      secretId: ctx.secretId ?? null,
      field: ctx.field ?? null,
      origin: ctx.origin ?? null,
      purpose: ctx.purpose ?? null,
      ...(ctx.extra ?? {}),
    };
  }

  private async writeAudit(
    caller: AgentCaller,
    action: AgentAuditAction,
    ctx: AuditContext,
    result: string,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: caller.userId,
      action,
      targetType: ctx.secretId ? 'secret' : 'user',
      targetId: ctx.secretId ?? caller.userId,
      meta: this.auditMeta(caller, ctx, result),
    });
  }

  /**
   * Runs `work` inside the pipeline. `ctx` is filled in by `work` as facts become known, so a denial
   * late in the call (origin mismatch) still records the secret id. A success is audited BEFORE the
   * value is returned (an unwritable trail fails the call closed); a denial is audited best effort
   * so the refusal itself is never masked.
   */
  private async run<T>(
    caller: AgentCaller,
    action: AgentAuditAction,
    bucket: Bucket,
    ctx: AuditContext,
    work: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      const kind = caller.credential?.kind;
      if (kind !== 'oauth' && kind !== 'pat') {
        throw new ForbiddenException({
          code: AGENT_ERROR_CODES.AGENT_CREDENTIAL_REQUIRED,
          message: 'The agent API accepts only an OAuth access token or a personal access token',
        });
      }
      const settings = await this.loadSettings();
      if (!settings.enabled) throw this.disabled();
      const decision = this.limiter.consume(
        `${bucket}:${this.principalKey(caller)}:${caller.userId}`,
        settings[BUCKET_SETTING[bucket]] as number,
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
      try {
        await this.writeAudit(caller, action, ctx, `denied:${denialReason(error)}`);
      } catch (auditError) {
        this.logger.error(`Agent audit write failed for ${action}: ${(auditError as Error).name}`);
      }
      throw error;
    }
    await this.writeAudit(caller, action, ctx, 'ok');
    return result;
  }

  private requireOrigin(input: string): string {
    const origin = normalizeOrigin(input);
    if (!origin) throw new BadRequestException('origin is not a valid https origin');
    return origin;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Secret not found');
  }

  private mismatch(): ForbiddenException {
    return new ForbiddenException({
      code: AGENT_ERROR_CODES.ORIGIN_MISMATCH,
      message: 'The origin does not match this credential',
    });
  }

  /** The user's agent-accessible secret for `id` whose origins contain `origin` exactly. */
  private async exactSecret(caller: AgentCaller, id: string, rawOrigin: string, ctx: AuditContext) {
    ctx.secretId = id;
    const secret = await this.secrets.findAgentAccessibleSecret(caller.userId, id);
    this.secrets.assertAgentAccessible(secret);
    const origin = this.requireOrigin(rawOrigin);
    ctx.origin = origin;
    const origins: string[] = (secret as { origins?: string[] }).origins ?? [];
    if (matchOrigin(origin, origins)?.matchKind !== 'exact') throw this.mismatch();
    return secret!;
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /** `GET /credentials?origin=`: matches for the origin, exact first, with non-sensitive facts. */
  async lookup(caller: AgentCaller, rawOrigin: string): Promise<AgentCredentialSummary[]> {
    const ctx: AuditContext = {};
    return this.run(caller, AGENT_AUDIT_ACTIONS.LOOKUP, 'lookup', ctx, async () => {
      const origin = this.requireOrigin(rawOrigin);
      ctx.origin = origin;
      const matches = (await this.secrets.findCredentialsByOrigin(caller.userId, origin)).slice(0, MAX_LOOKUP_RESULTS);
      const details = await this.secrets.describeAgentCredentials(matches.map((m) => m.id));
      ctx.extra = { matches: matches.length };
      return matches.flatMap((match) => {
        const detail = details.get(match.id);
        if (!detail) return [];
        return [
          {
            id: match.id,
            name: match.name,
            username: detail.username,
            origins: match.origins,
            matchKind: match.matchKind,
            hasTotp: detail.hasTotp,
            updatedAt: detail.updatedAt,
          },
        ];
      });
    });
  }

  /** `POST /credentials/:id/fill`: ONE field of an exact-origin credential. */
  async fill(caller: AgentCaller, id: string, body: AgentFillRequest): Promise<{ value: string }> {
    const ctx: AuditContext = { field: body.field, purpose: body.purpose };
    return this.run(caller, AGENT_AUDIT_ACTIONS.FILL, 'fill', ctx, async () => {
      await this.exactSecret(caller, id, body.origin, ctx);
      const values = await this.secrets.readCurrentValues(id);
      const value = values[body.field];
      if (typeof value !== 'string') throw this.notFound();
      return { value };
    });
  }

  /** `POST /credentials/:id/totp`: the current one-time code of an exact-origin credential. */
  async totp(caller: AgentCaller, id: string, body: AgentTotpRequest): Promise<{ code: string; expiresAt: string }> {
    const ctx: AuditContext = { field: 'totp', purpose: body.purpose };
    return this.run(caller, AGENT_AUDIT_ACTIONS.TOTP, 'totp', ctx, async () => {
      const secret = await this.exactSecret(caller, id, body.origin, ctx);
      const { code, expiresAt } = await this.secrets.generateTotpForSecret(secret);
      return { code, expiresAt };
    });
  }

  /** `POST /credentials`: a new agent-accessible Credential; a generated password is returned once. */
  async create(
    caller: AgentCaller,
    body: AgentCreateCredentialRequest,
  ): Promise<{ id: string; name: string; username: string; origins: string[]; generatedPassword?: string }> {
    const ctx: AuditContext = { field: 'password', purpose: body.purpose };
    return this.run(caller, AGENT_AUDIT_ACTIONS.CREATE, 'write', ctx, async () => {
      const origin = this.requireOrigin(body.origin);
      ctx.origin = origin;
      const extra: string[] = [];
      for (const url of body.additionalUrls ?? []) {
        const normalized = normalizeOrigin(url);
        if (!normalized) throw new BadRequestException('additionalUrls holds an invalid https origin');
        extra.push(normalized);
      }
      const generated = body.generate ? generatePassword(body.generate) : undefined;
      const password = generated ?? body.password!;
      const created = await this.secrets.createAgentCredential(caller.userId, {
        name: body.name,
        values: {
          username: body.username,
          password,
          url: origin,
          ...(extra.length > 0 ? { additional_urls: extra.join(' ') } : {}),
        },
      });
      ctx.secretId = created.id;
      ctx.extra = { generated: generated !== undefined };
      return {
        id: created.id,
        name: created.name,
        username: body.username,
        origins: created.origins,
        ...(generated !== undefined ? { generatedPassword: generated } : {}),
      };
    });
  }

  /** `POST /credentials/:id/password`: rotate by adding a version; a generated password is returned once. */
  async rotate(
    caller: AgentCaller,
    id: string,
    body: AgentRotatePasswordRequest,
  ): Promise<{ id: string; version: number; generatedPassword?: string }> {
    const ctx: AuditContext = { field: 'password', purpose: body.purpose };
    return this.run(caller, AGENT_AUDIT_ACTIONS.ROTATE, 'write', ctx, async () => {
      await this.exactSecret(caller, id, body.origin, ctx);
      const generated = body.generate ? generatePassword(body.generate) : undefined;
      const { version } = await this.secrets.rotateCredentialPassword(id, caller.userId, generated ?? body.password!);
      ctx.extra = { generated: generated !== undefined, version };
      return { id, version, ...(generated !== undefined ? { generatedPassword: generated } : {}) };
    });
  }
}
