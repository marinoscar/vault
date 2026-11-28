import { z } from 'zod';

/**
 * The credential broker (issue #246, ADR-0006): an agent USES a key stored in Vault without ever
 * seeing it. The agent calls `/api/broker/v1/:secretId/:upstreamHost/*`, Vault adds the key
 * server-side and forwards the request to an upstream origin the owner allowed.
 *
 * This entry point holds the wire shapes (the owner's per-secret opt-in, the broker tokens), the
 * error codes and the constants the API, the web app and the CLI share. The settings
 * (`agentAccess.broker`) live in `@marinoscar/vault-contract/agent`.
 *
 * @packageDocumentation
 */

/** Prefix of a broker token. @stability experimental */
export const BROKER_TOKEN_PREFIX = 'vbk_' as const;

/** Random base62 characters after the prefix. @stability experimental */
export const BROKER_TOKEN_RANDOM_LENGTH = 40;

/** Characters of the token shown in lists (`vbk_` plus eight). @stability experimental */
export const BROKER_TOKEN_DISPLAY_PREFIX_LENGTH = 12;

/** The base path of the forwarding endpoint (a `vbk_` token reaches nothing else). @stability experimental */
export const BROKER_API_BASE_PATH = '/api/broker/v1' as const;

/** The path of the broker token management routes. @stability experimental */
export const BROKER_TOKENS_PATH = '/api/broker/tokens' as const;

/** Most origins one secret may allow. @stability experimental */
export const MAX_BROKER_ORIGINS = 20;

/** Default and largest token lifetime, in days. @stability experimental */
export const BROKER_TOKEN_DEFAULT_EXPIRES_DAYS = 90;
/** @stability experimental */
export const BROKER_TOKEN_MAX_EXPIRES_DAYS = 3650;

/** Most secrets one token may be restricted to. @stability experimental */
export const MAX_BROKER_TOKEN_SECRETS = 100;

/** The audit action of one forwarded (or refused) broker call. @stability experimental */
export const BROKER_FORWARD_AUDIT_ACTION = 'broker.forward' as const;

/** The audit action of the owner's per-secret broker opt-in. @stability experimental */
export const BROKER_ACCESS_TOGGLE_AUDIT_ACTION = 'secret.broker_access.update' as const;

/** The audit actions of the broker token lifecycle. @stability experimental */
export const BROKER_TOKEN_AUDIT_ACTIONS = {
  CREATE: 'broker.token.create',
  REVOKE: 'broker.token.revoke',
} as const;

/** The response header every forwarded response carries. @stability experimental */
export const BROKER_RESPONSE_HEADER = 'x-vault-broker' as const;

/**
 * The broker's error codes (registered in `@marinoscar/vault-contract/errors` with their status).
 * `RATE_LIMITED` (429) is the agent API's.
 *
 * @stability experimental
 */
export const BROKER_ERROR_CODES = {
  /** 403: `agentAccess.enabled` or `agentAccess.broker.enabled` is off. */
  BROKER_DISABLED: 'BROKER_DISABLED',
  /** 403: the credential is not a `vbk_` or `pat_` token (an `oat_` token, a session). */
  BROKER_CREDENTIAL_REFUSED: 'BROKER_CREDENTIAL_REFUSED',
  /** 403: the upstream origin is not exactly one of the secret's allowed origins. */
  BROKER_ORIGIN_MISMATCH: 'BROKER_ORIGIN_MISMATCH',
  /** 403: the host resolves to a private, loopback, link-local or otherwise blocked address. */
  BROKER_DESTINATION_BLOCKED: 'BROKER_DESTINATION_BLOCKED',
  /** 413: the request body is above `agentAccess.broker.maxRequestBytes`. */
  BROKER_REQUEST_TOO_LARGE: 'BROKER_REQUEST_TOO_LARGE',
  /** 502: the response is above `agentAccess.broker.maxResponseBytes`. */
  BROKER_RESPONSE_TOO_LARGE: 'BROKER_RESPONSE_TOO_LARGE',
  /** 504: the upstream did not answer within `agentAccess.broker.timeoutMs`. */
  BROKER_UPSTREAM_TIMEOUT: 'BROKER_UPSTREAM_TIMEOUT',
  /** 502: the connection to the upstream failed (no detail is returned). */
  BROKER_UPSTREAM_ERROR: 'BROKER_UPSTREAM_ERROR',
  /** 502: the upstream response contained the key and was withheld. */
  BROKER_KEY_ECHO: 'BROKER_KEY_ECHO',
  /** 422: the secret has no value in the field the broker injects. */
  BROKER_KEY_MISSING: 'BROKER_KEY_MISSING',
  /** 422: the secret's type cannot be used through the broker. */
  BROKER_UNSUPPORTED_TYPE: 'BROKER_UNSUPPORTED_TYPE',
  /** 422: enabling the broker needs at least one origin. */
  BROKER_ORIGINS_REQUIRED: 'BROKER_ORIGINS_REQUIRED',
  /** 422: an origin is not an exact, public HTTPS origin. */
  BROKER_ORIGIN_INVALID: 'BROKER_ORIGIN_INVALID',
  /** 422: the injection stored on the secret no longer validates; send a new one. */
  BROKER_INJECTION_INVALID: 'BROKER_INJECTION_INVALID',
  /** 422: `field` is not a sensitive field of the secret's type. */
  BROKER_FIELD_INVALID: 'BROKER_FIELD_INVALID',
  /** 422: a token restriction names a secret that is not the caller's own broker-enabled secret. */
  BROKER_TOKEN_SECRET_INVALID: 'BROKER_TOKEN_SECRET_INVALID',
} as const;

/** @stability experimental */
export type BrokerErrorCode = (typeof BROKER_ERROR_CODES)[keyof typeof BROKER_ERROR_CODES];

// -----------------------------------------------------------------------------
// Injection
// -----------------------------------------------------------------------------

/** Words allowed before the key in an injected header. @stability experimental */
export const BROKER_HEADER_PREFIXES = ['', 'Bearer', 'Token', 'Basic', 'Bot', 'ApiKey'] as const;

/**
 * Header names an injection may never use: they steer the connection, carry another credential or
 * identify the proxy. `proxy-*`, `x-forwarded-*` and `x-vault-*` are refused by prefix.
 *
 * @stability experimental
 */
export const BROKER_FORBIDDEN_INJECTION_HEADERS: readonly string[] = Object.freeze([
  'host',
  'cookie',
  'set-cookie',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'forwarded',
  'x-real-ip',
]);

const FORBIDDEN_HEADER_PREFIXES = ['proxy-', 'x-forwarded-', 'x-vault-'] as const;

/** Whether `name` may not carry an injected key. @stability experimental */
export function isForbiddenInjectionHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return BROKER_FORBIDDEN_INJECTION_HEADERS.includes(lower) || FORBIDDEN_HEADER_PREFIXES.some((p) => lower.startsWith(p));
}

/** A header injection: `Name: <prefix> <key>`. @stability experimental */
export const brokerHeaderInjectionSchema = z.object({
  kind: z.literal('header'),
  name: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, 'A header name is 1 to 64 letters, digits or hyphens')
    .refine((n) => !isForbiddenInjectionHeader(n), 'This header name cannot carry an injected key'),
  prefix: z.enum(BROKER_HEADER_PREFIXES).optional(),
});

/** A query parameter injection: `?name=<key>`. @stability experimental */
export const brokerQueryInjectionSchema = z.object({
  kind: z.literal('query'),
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'A query parameter name is 1 to 64 letters, digits, dots, hyphens or underscores'),
});

/** How the key is added to the forwarded request. @stability experimental */
export const brokerInjectionSchema = z.discriminatedUnion('kind', [brokerHeaderInjectionSchema, brokerQueryInjectionSchema]);

/** @stability experimental */
export type BrokerInjection = z.infer<typeof brokerInjectionSchema>;

/** What an unset injection means: `Authorization: Bearer <key>`. @stability experimental */
export const DEFAULT_BROKER_INJECTION: BrokerInjection = Object.freeze({
  kind: 'header',
  name: 'Authorization',
  prefix: 'Bearer',
}) as BrokerInjection;

/**
 * Body of `PATCH /api/secrets/:id/broker-access`. `origins`, `injection` and `field` replace the
 * stored values when sent and are kept when omitted. Origins are validated by the API (exact public
 * HTTPS origins).
 *
 * @stability experimental
 */
export const updateBrokerAccessSchema = z.object({
  enabled: z.boolean(),
  origins: z.array(z.string().trim().min(1).max(2048)).max(MAX_BROKER_ORIGINS).optional(),
  injection: brokerInjectionSchema.optional(),
  field: z.string().trim().min(1).max(100).optional(),
});

/** @stability experimental */
export type UpdateBrokerAccess = z.infer<typeof updateBrokerAccessSchema>;

/**
 * The broker fields a secret list item and detail carry. Absent from an older API.
 *
 * @stability experimental
 */
export const secretBrokerFieldsSchema = z.object({
  brokerAccess: z.boolean().optional(),
  brokerOrigins: z.array(z.string()).optional(),
  brokerInjection: brokerInjectionSchema.nullable().optional(),
  brokerField: z.string().nullable().optional(),
  brokerAccessChangedAt: z.string().nullable().optional(),
});

// -----------------------------------------------------------------------------
// Broker tokens
// -----------------------------------------------------------------------------

/**
 * Body of `POST /api/broker/tokens`. `expiresInDays` is 1 to 3650 (default 90): a broker token
 * always expires. `secretIds` restricts the token to those secrets (the caller's own broker-enabled
 * secrets); empty or absent means every broker-enabled secret of the owner.
 *
 * @stability experimental
 */
export const createBrokerTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(BROKER_TOKEN_MAX_EXPIRES_DAYS).default(BROKER_TOKEN_DEFAULT_EXPIRES_DAYS),
  secretIds: z.array(z.string().uuid()).max(MAX_BROKER_TOKEN_SECRETS).optional(),
});

/** @stability experimental */
export type CreateBrokerToken = z.infer<typeof createBrokerTokenSchema>;

/** One token in `GET /api/broker/tokens`: never the token or its hash. @stability experimental */
export const brokerTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The first 12 characters, for recognition. */
  tokenPrefix: z.string(),
  secretIds: z.array(z.string()),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** @stability experimental */
export type BrokerToken = z.infer<typeof brokerTokenSchema>;

/** The response of `POST /api/broker/tokens`: the one time the token is shown. @stability experimental */
export const createdBrokerTokenSchema = brokerTokenSchema.extend({
  token: z.string(),
});

/** @stability experimental */
export type CreatedBrokerToken = z.infer<typeof createdBrokerTokenSchema>;

/** Whether `value` has the shape of a broker token (not whether it is valid). @stability experimental */
export function isBrokerTokenShape(value: string): boolean {
  return new RegExp(`^${BROKER_TOKEN_PREFIX}[A-Za-z0-9]{${BROKER_TOKEN_RANDOM_LENGTH}}$`).test(value);
}

/**
 * The base URL an SDK points at: `<apiBase>/broker/v1/<secretId>/<host[:port]>`.
 *
 * @param apiBase - the API base URL, e.g. `https://vault.example.test/api`.
 * @param secretId - the secret id.
 * @param origin - an allowed origin (`https://host[:port]`).
 * @stability experimental
 */
export function brokerBaseUrl(apiBase: string, secretId: string, origin: string): string {
  const host = origin.replace(/^https:\/\//i, '').replace(/\/+$/, '');
  return `${apiBase.replace(/\/+$/, '')}/broker/v1/${secretId}/${host}`;
}
