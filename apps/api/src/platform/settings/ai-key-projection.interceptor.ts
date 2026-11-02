// =============================================================================
// The AI key on /api/system-settings (issue #79, E4.1)
// =============================================================================
//
// The platform's settings registry refuses a secret-named field, so Vault's `ai`
// namespace cannot carry `apiKey`. The wire contract of the admin AI card stays
// what it was, and this global interceptor keeps it on the credential store
// (purpose `ai`, name `openai`, E4.2):
//
//   PATCH  body `ai.apiKey`   absent -> keep the key, null -> clear it,
//                             string -> encrypt and replace it. The field is
//                             REMOVED from the request before the platform sees
//                             it, so it never reaches validation, the stored
//                             row, a log line or an audit row.
//   GET/PUT/PATCH response    `ai` gains the masked projection
//                             `apiKeyConfigured`, `apiKeyLast4`, `apiKeyUpdatedAt`
//                             (from `CredentialsService.describe`: never the key).
//
// The key change is applied AFTER the settings write succeeded, so a stale
// `If-Match` (409) or a validation error never changes the key. A store failure
// is a 503 the admin can act on (`SECRETS_ENCRYPTION_KEY`), and the audit row
// records only that the key changed and its mask.
//
// Only `/api/system-settings` is touched; every other route passes through.
// =============================================================================

import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { Observable, from, mergeMap } from 'rxjs';

import { PrismaService } from '../../prisma/prisma.service';
import {
  VAULT_AI_CREDENTIAL_LABEL,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../credentials/credentials.config';

const SYSTEM_SETTINGS_PATH = '/api/system-settings';
const HINT_MASK = '••••';
const API_KEY_MIN = 20;
const API_KEY_MAX = 300;

type ApiKeyChange = { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; plaintext: string };

interface RequestLike {
  method?: string;
  url?: string;
  body?: unknown;
  requestUser?: { id?: string };
  user?: { id?: string };
}

/** The revealed tail of a credential hint (`••••1234` -> `1234`), or null. */
export function lastFourOfHint(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const tail = hint.startsWith(HINT_MASK) ? hint.slice(HINT_MASK.length) : hint;
  return tail.length > 0 ? tail : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class AiKeyProjectionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AiKeyProjectionInterceptor.name);

  constructor(
    private readonly credentials: CredentialsService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestLike>();
    const method = request.method?.toUpperCase();
    const path = (request.url ?? '').split('?')[0].replace(/\/+$/, '');
    if (path !== SYSTEM_SETTINGS_PATH || (method !== 'GET' && method !== 'PUT' && method !== 'PATCH')) {
      return next.handle();
    }

    // Take the key out of the request before anything else can see it.
    const change = method === 'PATCH' ? this.takeApiKeyChange(request) : ({ kind: 'keep' } as const);
    const userId = (request.requestUser ?? request.user)?.id ?? null;

    return next.handle().pipe(
      mergeMap((result) => from(this.finish(result, change, userId))),
    );
  }

  /** Removes `ai.apiKey` from the body and says what it asked for. */
  private takeApiKeyChange(request: RequestLike): ApiKeyChange {
    const body = request.body;
    if (!isObject(body) || !isObject(body.ai) || !('apiKey' in body.ai)) return { kind: 'keep' };

    const provided = body.ai.apiKey;
    delete body.ai.apiKey;

    if (provided === null) return { kind: 'clear' };
    if (provided === undefined) return { kind: 'keep' };
    if (typeof provided !== 'string' || provided.length < API_KEY_MIN || provided.length > API_KEY_MAX) {
      // Never echo the value.
      throw new BadRequestException(`ai.apiKey must be a string of ${API_KEY_MIN} to ${API_KEY_MAX} characters, or null`);
    }
    return { kind: 'set', plaintext: provided };
  }

  private async finish(result: unknown, change: ApiKeyChange, userId: string | null): Promise<unknown> {
    await this.applyChange(change, userId);

    // The response is the settings document, enveloped or not.
    const enveloped = isObject(result) && isObject(result.data) && 'version' in result.data;
    const doc = enveloped ? (result as { data: Record<string, unknown> }).data : result;
    if (!isObject(doc) || !isObject(doc.ai)) return result;

    const info = await this.credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME);
    const projected = {
      ...doc,
      ai: {
        ...doc.ai,
        apiKeyConfigured: info !== null,
        apiKeyLast4: lastFourOfHint(info?.hint),
        apiKeyUpdatedAt: info ? info.updatedAt.toISOString() : null,
      },
    };
    return enveloped ? { ...(result as object), data: projected } : projected;
  }

  /** Applies the change to the credential store; returns the new mask, or null. */
  private async applyChange(change: ApiKeyChange, userId: string | null): Promise<string | null> {
    if (change.kind === 'keep') return null;

    let last4: string | null = null;
    if (change.kind === 'clear') {
      await this.credentials.deleteSecret(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME);
    } else {
      try {
        await this.credentials.setSecret(
          VAULT_AI_CREDENTIAL_PURPOSE,
          VAULT_AI_CREDENTIAL_NAME,
          change.plaintext,
          { label: VAULT_AI_CREDENTIAL_LABEL, ...(userId ? { updatedByUserId: userId } : {}) },
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.error(`Failed to store AI API key: ${(error as Error)?.message}`);
        throw new ServiceUnavailableException({
          code: 'ENCRYPTION_UNAVAILABLE',
          message:
            'Encryption is not available, so the API key could not be stored. Check that SECRETS_ENCRYPTION_KEY is configured, then re-enter the key.',
        });
      }
      const info = await this.credentials.describe(VAULT_AI_CREDENTIAL_PURPOSE, VAULT_AI_CREDENTIAL_NAME);
      last4 = lastFourOfHint(info?.hint);
    }

    // Audit rows are permanent: the mask only, never the key.
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'system_settings:ai_key',
        targetType: 'system_settings',
        targetId: 'global',
        meta: { change: change.kind, apiKeyLast4: last4 },
      },
    });
    this.logger.log(`AI API key ${change.kind === 'set' ? 'replaced' : 'cleared'} by user: ${userId ?? 'unknown'}`);
    return last4;
  }
}
