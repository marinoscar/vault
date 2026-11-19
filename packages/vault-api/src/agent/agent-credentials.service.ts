import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AGENT_AUDIT_ACTIONS,
  AGENT_ERROR_CODES,
  agentContractInfoFor,
  type AgentAuditAction,
  type AgentContractInfo,
  type AgentCreateCredentialRequest,
  type AgentCredentialSummary,
  type AgentFillRequest,
  type AgentRotatePasswordRequest,
  type AgentTotpRequest,
} from '@marinoscar/vault-contract/agent';
import { matchOrigin, normalizeOrigin } from '@marinoscar/vault-contract/secrets';

import { SecretsService } from '../secrets/secrets.service';
import { AgentNotifier } from './agent-notifier.service';
import {
  AgentCallPipeline,
  type AgentAuditContext,
  type AgentBucket,
  type AgentCaller,
} from './agent-pipeline';
import { generatePassword } from './password-generator';

/** Most credentials one lookup returns. */
const MAX_LOOKUP_RESULTS = 25;

type AuditContext = AgentAuditContext;

/**
 * The login half of the agent rules (`/api/agent/v1/credentials`, ADR-0002). Every call runs through
 * {@link AgentCallPipeline}: credential kind (`oat_` or `pat_`, never a browser session; or an
 * in-process host), the deployment kill switch, the rate limit, then the work, then one audit row.
 * Nothing sensitive reaches a log, a span, an error or an audit row. A secret that is missing,
 * foreign, not opened to agents or not a Credential is a plain 404. Callers use it through
 * `AgentReleaseService` (the in-process port) or the HTTP controller.
 *
 * @stability experimental
 */
@Injectable()
export class AgentCredentialsService {
  constructor(
    private readonly secrets: SecretsService,
    private readonly pipeline: AgentCallPipeline,
    private readonly notifier: AgentNotifier,
  ) {}

  /** Kill switch only (whoami): no credential restriction, no rate limit, no audit. */
  async assertEnabled(): Promise<void> {
    await this.pipeline.assertEnabled();
  }

  /**
   * `whoami`'s `contract` block (contract 1.2): the version and the features on now. Kill switch
   * only, like {@link assertEnabled}: no credential restriction, no rate limit, no audit.
   */
  async contractInfo(): Promise<AgentContractInfo> {
    const settings = await this.pipeline.loadSettings();
    if (!settings.enabled) await this.pipeline.assertEnabled();
    return agentContractInfoFor(settings);
  }

  private run<T>(
    caller: AgentCaller,
    action: AgentAuditAction,
    bucket: AgentBucket,
    ctx: AuditContext,
    work: () => Promise<T>,
  ): Promise<T> {
    let firstFill = false;
    return this.pipeline.run(caller, { action, bucket }, ctx, work, {
      // The new-app check reads the trail, so it runs BEFORE this call's own row is written.
      beforeAudit: async () => {
        firstFill = action === AGENT_AUDIT_ACTIONS.FILL ? await this.notifier.isFirstFill(caller, action) : false;
      },
      afterAudit: () => this.notifyOwner(caller, action, ctx, firstFill),
    });
  }

  /**
   * Tells the owner about a successful call. Runs after the work committed and the audit row was
   * written, outside any transaction; the notifier never throws.
   */
  private async notifyOwner(caller: AgentCaller, action: AgentAuditAction, ctx: AuditContext, firstFill: boolean): Promise<void> {
    if (!ctx.secretId || !ctx.secretName) return;
    const facts = { secretId: ctx.secretId, secretName: ctx.secretName, origin: ctx.origin ?? null };
    switch (action) {
      case AGENT_AUDIT_ACTIONS.FILL:
        if (firstFill) await this.notifier.newApp(caller, facts);
        await this.notifier.credentialUsed(caller, 'fill', facts);
        return;
      case AGENT_AUDIT_ACTIONS.TOTP:
        await this.notifier.credentialUsed(caller, 'totp', facts);
        return;
      case AGENT_AUDIT_ACTIONS.CREATE:
        await this.notifier.credentialChanged(caller, 'created', facts);
        return;
      case AGENT_AUDIT_ACTIONS.ROTATE:
        await this.notifier.credentialChanged(caller, 'rotated', facts);
        return;
      default:
        return;
    }
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
    ctx.secretName = (secret as { name?: string } | null)?.name;
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
      ctx.secretName = created.name;
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
