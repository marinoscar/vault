import { z } from 'zod';

/**
 * The agent credential API (`/api/agent/v1`, the `agent` OAuth protected resource): the provider
 * contract an external agent runtime (a browser fabric, an MCP host) codes against. A runtime finds
 * the login for the site on screen, asks for exactly ONE field at a time so it can type it without
 * showing it to a model, reads a one-time code, saves a new login with a generated password and
 * rotates a password.
 *
 * Request and response shapes only. Behaviour (origin binding, the kill switch, rate limits, audit)
 * is the API's; the error codes are in {@link AGENT_ERROR_CODES}. The path carries the version: an
 * incompatible change is `/api/agent/v2`.
 *
 * @packageDocumentation
 */

/** The API's base path (the `agent` protected resource). @stability experimental */
export const AGENT_API_BASE_PATH = '/api/agent/v1' as const;

/**
 * The OAuth scope ids of the agent resource (permanent: clients persist them). The platform's scope
 * id pattern rules out dots, so they are `vault:items_*`.
 *
 * @stability experimental
 */
export const AGENT_SCOPES = {
  ITEMS_READ: 'vault:items_read',
  ITEMS_FILL: 'vault:items_fill',
  ITEMS_WRITE: 'vault:items_write',
} as const;

/**
 * Error codes of the agent API, as they appear in `{ code }`. They are also in
 * `VAULT_ERROR_CODES` (`@marinoscar/vault-contract/errors`) with their statuses.
 *
 * @stability experimental
 */
export const AGENT_ERROR_CODES = {
  /** 403: the `origin` is not exactly one of the credential's origins. */
  ORIGIN_MISMATCH: 'ORIGIN_MISMATCH',
  /** 403: the deployment's `agentAccess.enabled` switch is off. */
  AGENT_ACCESS_DISABLED: 'AGENT_ACCESS_DISABLED',
  /** 403: the request authenticated with something other than an `oat_` or `pat_` token (a browser session). */
  AGENT_CREDENTIAL_REQUIRED: 'AGENT_CREDENTIAL_REQUIRED',
  /** 429: the per-minute limit of the call's bucket was reached; see `Retry-After`. */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/** @stability experimental */
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

/**
 * Why the agent is asking: stored in the audit row of fill, totp, create and rotate.
 *
 * @stability experimental
 */
export const agentPurposeSchema = z.enum(['login', 'signup', 'password_change', 'mfa']);

/** @stability experimental */
export type AgentPurpose = z.infer<typeof agentPurposeSchema>;

/** The one field a fill call returns. @stability experimental */
export const agentFillFieldSchema = z.enum(['username', 'password']);

/** @stability experimental */
export type AgentFillField = z.infer<typeof agentFillFieldSchema>;

/** An origin as the agent sees it: a URL or bare host, normalized by the API. @stability experimental */
export const agentOriginSchema = z.string().trim().min(1).max(2048);

/** Query of `GET /api/agent/v1/credentials`. @stability experimental */
export const agentLookupQuerySchema = z.object({
  origin: agentOriginSchema,
});

/** @stability experimental */
export type AgentLookupQuery = z.infer<typeof agentLookupQuerySchema>;

/** One credential found for an origin. Never carries a sensitive value. @stability experimental */
export const agentCredentialSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** The username (a non-sensitive field), or null when the credential has none. */
  username: z.string().nullable(),
  origins: z.array(z.string()),
  /** `exact`: the asked origin is one of the credential's. `site`: same registrable domain only (never fillable). */
  matchKind: z.enum(['exact', 'site']),
  hasTotp: z.boolean(),
  updatedAt: z.string(),
});

/** @stability experimental */
export type AgentCredentialSummary = z.infer<typeof agentCredentialSummarySchema>;

/** Response of `GET /api/agent/v1/credentials`. Exact matches first. @stability experimental */
export const agentLookupResponseSchema = z.object({ data: z.array(agentCredentialSummarySchema) });

/** Body of `POST /api/agent/v1/credentials/:id/fill`. @stability experimental */
export const agentFillRequestSchema = z.object({
  field: agentFillFieldSchema,
  origin: agentOriginSchema,
  purpose: agentPurposeSchema,
});

/** @stability experimental */
export type AgentFillRequest = z.infer<typeof agentFillRequestSchema>;

/** Response of the fill route: one value. Type it, never show it to a model. @stability experimental */
export const agentFillResponseSchema = z.object({ data: z.object({ value: z.string() }) });

/** Body of `POST /api/agent/v1/credentials/:id/totp`. @stability experimental */
export const agentTotpRequestSchema = z.object({
  origin: agentOriginSchema,
  purpose: agentPurposeSchema,
});

/** @stability experimental */
export type AgentTotpRequest = z.infer<typeof agentTotpRequestSchema>;

/** Response of the totp route. `expiresAt` is an ISO timestamp. @stability experimental */
export const agentTotpResponseSchema = z.object({
  data: z.object({ code: z.string(), expiresAt: z.string() }),
});

/** Smallest and largest generated password length. @stability experimental */
export const AGENT_GENERATED_PASSWORD_MIN_LENGTH = 12;
/** @stability experimental */
export const AGENT_GENERATED_PASSWORD_MAX_LENGTH = 128;
/** Length of a generated password when `generate.length` is omitted. @stability experimental */
export const AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH = 24;

/**
 * Ask Vault to generate the password: `length` 12 to 128 (default 24), `symbols` (default true).
 * The result has at least one lower-case letter, upper-case letter and digit, and one symbol when
 * `symbols` is on.
 *
 * @stability experimental
 */
export const agentGeneratePasswordSchema = z.object({
  length: z
    .number()
    .int()
    .min(AGENT_GENERATED_PASSWORD_MIN_LENGTH)
    .max(AGENT_GENERATED_PASSWORD_MAX_LENGTH)
    .default(AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH),
  symbols: z.boolean().default(true),
});

/** @stability experimental */
export type AgentGeneratePassword = z.infer<typeof agentGeneratePasswordSchema>;

const passwordValueSchema = z.string().min(1).max(1024);

/** Body of `POST /api/agent/v1/credentials`: exactly one of `password` and `generate`. @stability experimental */
export const agentCreateCredentialRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    username: z.string().trim().min(1).max(512),
    origin: agentOriginSchema,
    additionalUrls: z.array(agentOriginSchema).max(19).optional(),
    password: passwordValueSchema.optional(),
    generate: agentGeneratePasswordSchema.optional(),
    purpose: agentPurposeSchema,
  })
  .refine((body) => (body.password === undefined) !== (body.generate === undefined), {
    message: 'Send exactly one of password and generate',
    path: ['password'],
  });

/** @stability experimental */
export type AgentCreateCredentialRequest = z.infer<typeof agentCreateCredentialRequestSchema>;

/**
 * Response of the create route. `generatedPassword` is present only when `generate` was sent, and
 * only in this response: Vault never returns it again.
 *
 * @stability experimental
 */
export const agentCreateCredentialResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    username: z.string(),
    origins: z.array(z.string()),
    generatedPassword: z.string().optional(),
  }),
});

/** Body of `POST /api/agent/v1/credentials/:id/password`: exactly one of `password` and `generate`. @stability experimental */
export const agentRotatePasswordRequestSchema = z
  .object({
    origin: agentOriginSchema,
    password: passwordValueSchema.optional(),
    generate: agentGeneratePasswordSchema.optional(),
    purpose: agentPurposeSchema,
  })
  .refine((body) => (body.password === undefined) !== (body.generate === undefined), {
    message: 'Send exactly one of password and generate',
    path: ['password'],
  });

/** @stability experimental */
export type AgentRotatePasswordRequest = z.infer<typeof agentRotatePasswordRequestSchema>;

/** Response of the rotate route: the new version number, and the generated value once. @stability experimental */
export const agentRotatePasswordResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    version: z.number().int(),
    generatedPassword: z.string().optional(),
  }),
});

/** Response of `GET /api/agent/v1/whoami`. @stability experimental */
export const agentWhoamiResponseSchema = z.object({
  data: z.object({
    userId: z.string(),
    scopes: z.array(z.string()),
    clientId: z.string().nullable(),
  }),
});

/**
 * The audit actions the agent API writes (`audit_events.action`), one per route. The `result` of
 * the row's meta is `ok` or `denied:<reason>`.
 *
 * @stability experimental
 */
export const AGENT_AUDIT_ACTIONS = {
  LOOKUP: 'agent.credential.lookup',
  FILL: 'agent.credential.fill',
  TOTP: 'agent.credential.totp',
  CREATE: 'agent.credential.create',
  ROTATE: 'agent.credential.rotate',
} as const;

/** @stability experimental */
export type AgentAuditAction = (typeof AGENT_AUDIT_ACTIONS)[keyof typeof AGENT_AUDIT_ACTIONS];

/**
 * The `agentAccess` system settings namespace: the kill switch and the per-minute limits of the
 * agent API. `enabled` defaults to `false`: until an administrator switches it on, every agent
 * route answers `403 AGENT_ACCESS_DISABLED`. Each limit counts per token (or OAuth grant) and user.
 *
 * @stability experimental
 */
export const agentAccessSettingsSchema = z.object({
  enabled: z.boolean(),
  lookupPerMinute: z.number().int().min(1).max(10_000),
  fillPerMinute: z.number().int().min(1).max(10_000),
  totpPerMinute: z.number().int().min(1).max(10_000),
  writePerMinute: z.number().int().min(1).max(10_000),
});

/** @stability experimental */
export type AgentAccessSettings = z.infer<typeof agentAccessSettingsSchema>;

/** Defaults of {@link agentAccessSettingsSchema}: off, lookup 60, fill 30, totp 10, write 10 per minute. @stability experimental */
export const AGENT_ACCESS_SETTINGS_DEFAULTS: AgentAccessSettings = Object.freeze({
  enabled: false,
  lookupPerMinute: 60,
  fillPerMinute: 30,
  totpPerMinute: 10,
  writePerMinute: 10,
});
