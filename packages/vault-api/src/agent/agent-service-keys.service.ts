import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import {
  AGENT_AUDIT_ACTIONS,
  AGENT_ERROR_CODES,
  AGENT_SERVICE_KEY_PER_MINUTE,
  AGENT_SERVICE_KEY_PURPOSE,
  agentServiceKeyParamsSchema,
} from '@marinoscar/vault-contract/agent';

import { SecretsService } from '../secrets/secrets.service';
import { AgentCallPipeline, type AgentAuditContext, type AgentCaller } from './agent-pipeline';

/**
 * Who asks for a service key, and which one (issue #241). An embedding host passes `userId` (the
 * owner) and `clientLabel` (its own or its app's name: audited, rate-limited on and shown to the
 * owner) and leaves `credential` out; the HTTP controller passes the request's `oat_` or `pat_`.
 *
 * `service` and `name` come from the host's own configuration (which provider it calls), never from
 * a model or a page.
 *
 * @stability experimental
 */
export interface ServiceKeyReleaseInput {
  userId: string;
  clientLabel: string;
  credential?: AuthCredentialInfo | null;
  service: string;
  name: string;
}

/**
 * Service keys for a server process (issue #241): the in-process equivalent of
 * `GET /api/agent/v1/service-keys/:service/:name` for a host that embeds the packages. The same
 * rules apply: the kill switch `agentAccess.enabled`, the per-secret opt-in (`agentAccess = fill`),
 * the per-owner and per-service limit ({@link AGENT_SERVICE_KEY_PER_MINUTE} a minute), one audit row
 * per call (`agent.service_key.read`: service, name, caller; never the value), the identical `404`
 * and `409 SERVICE_KEY_AMBIGUOUS` when two opened keys share the service and name.
 *
 * The value comes back as a `Buffer` the caller owns: write it where it is needed, then wipe it
 * (`buffer.fill(0)`), including on failure paths. Vault decrypts the record through
 * `VaultCryptoPort.decrypt`, which returns a string, so a transient string of the record still
 * exists inside Vault's service until the garbage collector frees it; no string of the value is
 * handed to the host.
 *
 * Inject it with {@link SERVICE_KEY_RELEASE_PORT} (or the class {@link AgentServiceKeysService}).
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface ServiceKeyReleasePort {
  /** The value of the owner's opened service key `service`/`name`, as bytes the caller wipes. */
  releaseServiceKey(input: ServiceKeyReleaseInput): Promise<{ value: Buffer }>;
}

/**
 * The DI token of {@link ServiceKeyReleasePort}, bound to {@link AgentServiceKeysService} by `VaultApiModule`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SERVICE_KEY_RELEASE_PORT = Symbol.for('@marinoscar/vault/SERVICE_KEY_RELEASE_PORT');

/**
 * The one implementation of the service-key release (issue #241). The HTTP controller calls
 * {@link AgentServiceKeysService.read}; an embedded host calls {@link AgentServiceKeysService.releaseServiceKey}.
 *
 * @stability experimental
 */
@Injectable()
export class AgentServiceKeysService implements ServiceKeyReleasePort {
  constructor(
    private readonly secrets: SecretsService,
    private readonly pipeline: AgentCallPipeline,
  ) {}

  private caller(input: ServiceKeyReleaseInput): AgentCaller {
    return input.credential === undefined
      ? { userId: input.userId, clientLabel: input.clientLabel }
      : { userId: input.userId, credential: input.credential, clientLabel: input.clientLabel };
  }

  /** The release as a string: what the HTTP route answers with. */
  async read(input: ServiceKeyReleaseInput): Promise<{ value: string }> {
    const caller = this.caller(input);
    const params = agentServiceKeyParamsSchema.safeParse({ service: input.service, name: input.name });
    // The raw ids may be anything a caller typed: record them only once they are valid ids.
    const ctx: AgentAuditContext = {
      purpose: AGENT_SERVICE_KEY_PURPOSE,
      field: 'key',
      origin: null,
      extra: params.success ? { service: params.data.service, keyName: params.data.name } : {},
    };
    return this.pipeline.run(
      caller,
      {
        action: AGENT_AUDIT_ACTIONS.SERVICE_KEY_READ,
        bucket: 'service_key',
        limitKey: params.success ? `${caller.userId}:${params.data.service}` : `${caller.userId}:invalid`,
      },
      ctx,
      async () => {
        if (!params.success) {
          throw new BadRequestException({
            message: 'Validation failed',
            // Paths and messages only: never the submitted value.
            errors: params.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          });
        }
        const found = await this.secrets.readOpenedServiceKey(caller.userId, params.data.service, params.data.name);
        if (!found) throw new NotFoundException('Service key not found');
        if (found.kind === 'ambiguous') {
          ctx.extra = { ...ctx.extra, matches: found.secretIds.length };
          throw new ConflictException({
            code: AGENT_ERROR_CODES.SERVICE_KEY_AMBIGUOUS,
            message: 'More than one service key opened to agents has this service and name',
          });
        }
        ctx.secretId = found.secretId;
        ctx.secretName = found.secretName;
        return { value: found.value };
      },
    );
  }

  async releaseServiceKey(input: ServiceKeyReleaseInput): Promise<{ value: Buffer }> {
    const { value } = await this.read(input);
    return { value: Buffer.from(value, 'utf8') };
  }
}
