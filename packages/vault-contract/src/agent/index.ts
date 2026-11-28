import { z } from 'zod';

import { agentContractInfoSchema } from './contract-version.js';

/**
 * The agent credential API (`/api/agent/v1`, the `agent` OAuth protected resource): the provider
 * contract an external agent runtime (a browser fabric, an MCP host) codes against. A runtime finds
 * the login for the site on screen, asks for exactly ONE field at a time so it can type it without
 * showing it to a model, reads a one-time code, saves a new login with a generated password and
 * rotates a password. A server process reads a service key by service and name (contract 1.4).
 *
 * Request and response shapes only. Behaviour (origin binding, the kill switch, rate limits, audit)
 * is the API's; the error codes are in {@link AGENT_ERROR_CODES}. The path carries the version: an
 * incompatible change is `/api/agent/v2`.
 *
 * Stability: **beta** (issue #196). Inside `/api/agent/v1` the route paths, the required request
 * fields, the meaning of each error code, the scope names and the one-secret-field-per-response rule
 * do not change. New optional request fields, new response fields, new error codes and scopes for
 * new routes and stricter rate-limit defaults may arrive without a new version: ignore unknown
 * response fields and unknown enum values, and never branch on `message`. Anything else is
 * `/api/agent/v2`, and `v1` keeps working for two minor releases of the packages after `v2` ships.
 * The tag becomes `stable` at 1.0. Changes are listed under "Changes" in
 * `docs/agent-credential-api.md`; {@link AGENT_CONTRACT_VERSION} is the current version.
 *
 * @packageDocumentation
 */

/** The API's base path (the `agent` protected resource). @stability beta */
export const AGENT_API_BASE_PATH = '/api/agent/v1' as const;

/**
 * The OAuth scope ids of the agent resource (permanent: clients persist them). The platform's scope
 * id pattern rules out dots, so they are `vault:items_*`.
 *
 * @stability beta
 */
export const AGENT_SCOPES = {
  ITEMS_READ: 'vault:items_read',
  ITEMS_FILL: 'vault:items_fill',
  ITEMS_WRITE: 'vault:items_write',
  /** List the opened cards that have a live grant for a merchant (ADR-0003). */
  CARDS_READ: 'vault:cards_read',
  /** Fill one field of a granted card, and ask the owner for a grant. */
  CARDS_FILL: 'vault:cards_fill',
  /** List the opened identity items and the labels of their fields. */
  IDENTITY_READ: 'vault:identity_read',
  /** Fill one field of an opened identity item. */
  IDENTITY_FILL: 'vault:identity_fill',
  /** Read the value of a service key opened to agents, by service and name, for a server process (contract 1.4). */
  SERVICE_KEYS_READ: 'vault:service_keys_read',
} as const;

/**
 * Error codes of the agent API, as they appear in `{ code }`. They are also in
 * `VAULT_ERROR_CODES` (`@marinoscar/vault-contract/errors`) with their statuses.
 *
 * @stability beta
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
  /** 403: `GET /api/agent-activity` was called with an OAuth access token; an agent cannot read its own trail. */
  AGENT_ACTIVITY_FORBIDDEN: 'AGENT_ACTIVITY_FORBIDDEN',
  /** 403: the deployment's `agentAccess.cards.enabled` switch is off (ADR-0003). */
  CARD_ACCESS_DISABLED: 'CARD_ACCESS_DISABLED',
  /** 403: the deployment's `agentAccess.identity.enabled` switch is off (ADR-0003). */
  IDENTITY_ACCESS_DISABLED: 'IDENTITY_ACCESS_DISABLED',
  /** 403: `securityCode` was asked for under a grant that does not include it. */
  SECURITY_CODE_NOT_GRANTED: 'SECURITY_CODE_NOT_GRANTED',
  /** 403: the amount is above the grant's maximum. */
  CARD_AMOUNT_EXCEEDED: 'CARD_AMOUNT_EXCEEDED',
  /** 403: the currency is not the grant's. */
  CARD_CURRENCY_MISMATCH: 'CARD_CURRENCY_MISMATCH',
  /** 403: the grant's period limit (releases or total amount per day or month) was reached. */
  CARD_PERIOD_LIMIT_REACHED: 'CARD_PERIOD_LIMIT_REACHED',
  /** 403: the deployment's per-card daily cap of releases was reached. */
  CARD_DAILY_CAP_REACHED: 'CARD_DAILY_CAP_REACHED',
  /** 403: the card's grant for this merchant has expired. */
  CARD_GRANT_EXPIRED: 'CARD_GRANT_EXPIRED',
  /** 409: the card already has a live grant for this merchant site. */
  CARD_GRANT_EXISTS: 'CARD_GRANT_EXISTS',
  /** 409: the grant request was already approved or declined. */
  CARD_GRANT_REQUEST_NOT_PENDING: 'CARD_GRANT_REQUEST_NOT_PENDING',
  /** 403: the route changes what agents may do and needs the owner's browser session, never a token. */
  OWNER_SESSION_REQUIRED: 'OWNER_SESSION_REQUIRED',
  /** 409: more than one opened service key has this service and name; the owner keeps one (contract 1.4). */
  SERVICE_KEY_AMBIGUOUS: 'SERVICE_KEY_AMBIGUOUS',
} as const;

/** @stability beta */
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

/**
 * Why the agent is asking: stored in the audit row of fill, totp, create and rotate.
 *
 * `save_login` (contract 1.3) means saving a login the owner already uses on a site: send it with
 * `POST /credentials`. It is accepted wherever a purpose is, like every other value.
 *
 * @stability beta
 */
export const agentPurposeSchema = z.enum(['login', 'signup', 'password_change', 'mfa', 'save_login']);

/** @stability beta */
export type AgentPurpose = z.infer<typeof agentPurposeSchema>;

/** The one field a fill call returns. @stability beta */
export const agentFillFieldSchema = z.enum(['username', 'password']);

/** @stability beta */
export type AgentFillField = z.infer<typeof agentFillFieldSchema>;

/** An origin as the agent sees it: a URL or bare host, normalized by the API. @stability beta */
export const agentOriginSchema = z.string().trim().min(1).max(2048);

/** Query of `GET /api/agent/v1/credentials`. @stability beta */
export const agentLookupQuerySchema = z.object({
  origin: agentOriginSchema,
});

/** @stability beta */
export type AgentLookupQuery = z.infer<typeof agentLookupQuerySchema>;

/** One credential found for an origin. Never carries a sensitive value. @stability beta */
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

/** @stability beta */
export type AgentCredentialSummary = z.infer<typeof agentCredentialSummarySchema>;

/** Response of `GET /api/agent/v1/credentials`. Exact matches first. @stability beta */
export const agentLookupResponseSchema = z.object({ data: z.array(agentCredentialSummarySchema) });

/** Body of `POST /api/agent/v1/credentials/:id/fill`. @stability beta */
export const agentFillRequestSchema = z.object({
  field: agentFillFieldSchema,
  origin: agentOriginSchema,
  purpose: agentPurposeSchema,
});

/** @stability beta */
export type AgentFillRequest = z.infer<typeof agentFillRequestSchema>;

/** Response of the fill route: one value. Type it, never show it to a model. @stability beta */
export const agentFillResponseSchema = z.object({ data: z.object({ value: z.string() }) });

/** Body of `POST /api/agent/v1/credentials/:id/totp`. @stability beta */
export const agentTotpRequestSchema = z.object({
  origin: agentOriginSchema,
  purpose: agentPurposeSchema,
});

/** @stability beta */
export type AgentTotpRequest = z.infer<typeof agentTotpRequestSchema>;

/** Response of the totp route. `expiresAt` is an ISO timestamp. @stability beta */
export const agentTotpResponseSchema = z.object({
  data: z.object({ code: z.string(), expiresAt: z.string() }),
});

/** Smallest and largest generated password length. @stability beta */
export const AGENT_GENERATED_PASSWORD_MIN_LENGTH = 12;
/** @stability beta */
export const AGENT_GENERATED_PASSWORD_MAX_LENGTH = 128;
/** Length of a generated password when `generate.length` is omitted. @stability beta */
export const AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH = 24;

/**
 * Ask Vault to generate the password: `length` 12 to 128 (default 24), `symbols` (default true).
 * The result has at least one lower-case letter, upper-case letter and digit, and one symbol when
 * `symbols` is on.
 *
 * @stability beta
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

/** @stability beta */
export type AgentGeneratePassword = z.infer<typeof agentGeneratePasswordSchema>;

const passwordValueSchema = z.string().min(1).max(1024);

/** Body of `POST /api/agent/v1/credentials`: exactly one of `password` and `generate`. @stability beta */
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

/** @stability beta */
export type AgentCreateCredentialRequest = z.infer<typeof agentCreateCredentialRequestSchema>;

/**
 * Response of the create route. `generatedPassword` is present only when `generate` was sent, and
 * only in this response: Vault never returns it again.
 *
 * @stability beta
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

/** Body of `POST /api/agent/v1/credentials/:id/password`: exactly one of `password` and `generate`. @stability beta */
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

/** @stability beta */
export type AgentRotatePasswordRequest = z.infer<typeof agentRotatePasswordRequestSchema>;

/** Response of the rotate route: the new version number, and the generated value once. @stability beta */
export const agentRotatePasswordResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    version: z.number().int(),
    generatedPassword: z.string().optional(),
  }),
});

/**
 * Response of `GET /api/agent/v1/whoami`. `contract` (since contract 1.2) is the contract version
 * and the features this Vault offers now; it is absent on an older Vault, so treat a missing block
 * as version `1.0` with `logins` and `totp`.
 *
 * @stability beta
 */
export const agentWhoamiResponseSchema = z.object({
  data: z.object({
    userId: z.string(),
    scopes: z.array(z.string()),
    clientId: z.string().nullable(),
    contract: agentContractInfoSchema.optional(),
  }),
});

/** @stability beta */
export type AgentWhoamiResponse = z.infer<typeof agentWhoamiResponseSchema>;

/**
 * The audit actions the agent API writes (`audit_events.action`), one per route. The `result` of
 * the row's meta is `ok` or `denied:<reason>`.
 *
 * @stability beta
 */
export const AGENT_AUDIT_ACTIONS = {
  LOOKUP: 'agent.credential.lookup',
  FILL: 'agent.credential.fill',
  TOTP: 'agent.credential.totp',
  CREATE: 'agent.credential.create',
  ROTATE: 'agent.credential.rotate',
  CARD_LOOKUP: 'agent.card.lookup',
  CARD_FILL: 'agent.card.fill',
  CARD_GRANT_REQUEST: 'agent.card.grant_request',
  IDENTITY_LOOKUP: 'agent.identity.lookup',
  IDENTITY_FILL: 'agent.identity.fill',
  SERVICE_KEY_READ: 'agent.service_key.read',
} as const;

/** @stability beta */
export type AgentAuditAction = (typeof AGENT_AUDIT_ACTIONS)[keyof typeof AGENT_AUDIT_ACTIONS];

/**
 * The card part of the `agentAccess` settings (ADR-0003): the card kill switch (default off), the
 * `card_fill` bucket's per-minute limit and the per-card daily cap of releases (`number` fills).
 *
 * @stability beta
 */
export const agentCardAccessSettingsSchema = z.object({
  enabled: z.boolean(),
  fillPerMinute: z.number().int().min(1).max(10_000),
  releasesPerCardPerDay: z.number().int().min(1).max(1_000),
});

/** @stability beta */
export type AgentCardAccessSettings = z.infer<typeof agentCardAccessSettingsSchema>;

/**
 * The identity part of the `agentAccess` settings (ADR-0003): the identity kill switch (default off)
 * and the `identity_fill` bucket's per-minute limit.
 *
 * @stability beta
 */
export const agentIdentityAccessSettingsSchema = z.object({
  enabled: z.boolean(),
  fillPerMinute: z.number().int().min(1).max(10_000),
});

/** @stability beta */
export type AgentIdentityAccessSettings = z.infer<typeof agentIdentityAccessSettingsSchema>;

/**
 * The `agentAccess` system settings namespace: the kill switch and the per-minute limits of the
 * agent API (and `revealPerMinute`, the MCP `reveal_secret` limit). `enabled` defaults to `false`: until an administrator switches it on, every agent
 * route answers `403 AGENT_ACCESS_DISABLED`. Each limit counts per token (or OAuth grant) and user.
 * `cards` and `identity` are separate switches (default off) for card and identity release.
 *
 * @stability beta
 */
export const agentAccessSettingsSchema = z.object({
  enabled: z.boolean(),
  lookupPerMinute: z.number().int().min(1).max(10_000),
  fillPerMinute: z.number().int().min(1).max(10_000),
  totpPerMinute: z.number().int().min(1).max(10_000),
  writePerMinute: z.number().int().min(1).max(10_000),
  /**
   * `reveal_secret` calls per minute over MCP (#244; default 10). Optional on the wire so the agent
   * contract stays additive: a row stored before it resolves to the default.
   */
  revealPerMinute: z.number().int().min(1).max(10_000).optional(),
  cards: agentCardAccessSettingsSchema,
  identity: agentIdentityAccessSettingsSchema,
});

/** @stability beta */
export type AgentAccessSettings = z.infer<typeof agentAccessSettingsSchema>;

/**
 * Defaults of {@link agentAccessSettingsSchema}: off, lookup 60, fill 30, totp 10, write 10 per
 * minute; cards off, 10 card fills per minute, 5 releases per card per day; identity off, 20
 * identity fills per minute.
 *
 * @stability beta
 */
export const AGENT_ACCESS_SETTINGS_DEFAULTS: AgentAccessSettings = Object.freeze({
  enabled: false,
  lookupPerMinute: 60,
  fillPerMinute: 30,
  totpPerMinute: 10,
  writePerMinute: 10,
  revealPerMinute: 10,
  cards: Object.freeze({ enabled: false, fillPerMinute: 10, releasesPerCardPerDay: 5 }),
  identity: Object.freeze({ enabled: false, fillPerMinute: 20 }),
}) as AgentAccessSettings;

/**
 * A stored (possibly older, partial) `agentAccess` value merged over the defaults, nested blocks
 * included. A row written before ADR-0003 has no `cards` or `identity`: both stay off.
 *
 * @stability beta
 */
export function resolveAgentAccessSettings(stored: unknown): AgentAccessSettings {
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const block = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    ...AGENT_ACCESS_SETTINGS_DEFAULTS,
    ...source,
    cards: { ...AGENT_ACCESS_SETTINGS_DEFAULTS.cards, ...block(source.cards) },
    identity: { ...AGENT_ACCESS_SETTINGS_DEFAULTS.identity, ...block(source.identity) },
  } as AgentAccessSettings;
}

// -----------------------------------------------------------------------------
// Agent activity (`GET /api/agent-activity`, E14.7)
// -----------------------------------------------------------------------------

/** The path of the owner's agent activity list (session or PAT, never an OAuth token). @stability beta */
export const AGENT_ACTIVITY_PATH = '/api/agent-activity' as const;

/** The audit action of the per-secret agent access toggle (`secret.agent_access.update`). @stability beta */
export const AGENT_ACCESS_TOGGLE_AUDIT_ACTION = 'secret.agent_access.update' as const;

/** The audit action of the owner's "Reveal to assistants" toggle (#244). @stability experimental */
export const ASSISTANT_REVEAL_TOGGLE_AUDIT_ACTION = 'secret.assistant_reveal.update' as const;

/** The MCP tool whose `mcp.tool.call` audit rows the activity list shows as `mcp_reveal` (#244). @stability experimental */
export const MCP_REVEAL_TOOL_NAME = 'reveal_secret' as const;

/**
 * The actions an activity item carries: the agent routes (logins, cards, identity, service keys),
 * the owner's toggle and the owner's grant decisions (`card_grant`: created, revoked, approved, declined).
 *
 * @stability beta
 */
export const agentActivityActionSchema = z.enum([
  'lookup',
  'fill',
  'totp',
  'create',
  'rotate',
  'agent_access',
  'card_lookup',
  'card_fill',
  'card_grant_request',
  'identity_lookup',
  'identity_fill',
  'card_grant',
  'service_key',
  'mcp_reveal',
]);

/** @stability beta */
export type AgentActivityAction = z.infer<typeof agentActivityActionSchema>;

/** The kind of credential a call authenticated with. @stability beta */
export const agentActivityCredentialKindSchema = z.enum(['oauth', 'pat', 'session', 'embedded']);

/** @stability beta */
export type AgentActivityCredentialKind = z.infer<typeof agentActivityCredentialKindSchema>;

/** The largest `pageSize` of the activity list. @stability beta */
export const AGENT_ACTIVITY_MAX_PAGE_SIZE = 100;

/**
 * Query of `GET /api/agent-activity`. `action` is one of {@link agentActivityActionSchema};
 * `from` and `to` are ISO 8601 instants (inclusive); `clientId` is the OAuth client's id as on its grants (`OAuthGrant.clientId`, not the public client_id string).
 *
 * @stability beta
 */
export const agentActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(AGENT_ACTIVITY_MAX_PAGE_SIZE).default(25),
  action: agentActivityActionSchema.optional(),
  secretId: z.string().uuid().optional(),
  clientId: z.string().trim().min(1).max(512).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** @stability beta */
export type AgentActivityQuery = z.infer<typeof agentActivityQuerySchema>;

/**
 * One event of the owner's agent trail. Never carries a value, a code, a seed or a password.
 * `reason` is present on a denial (`origin_mismatch`, `rate_limited`, `not_found`, ...).
 *
 * @stability beta
 */
export const agentActivityItemSchema = z.object({
  id: z.string(),
  /** ISO 8601. */
  at: z.string(),
  action: agentActivityActionSchema,
  result: z.enum(['ok', 'denied']),
  reason: z.string().optional(),
  secretId: z.string().nullable(),
  /** The secret's current name; null when it was deleted or the event names no secret. */
  secretName: z.string().nullable(),
  field: z.string().nullable(),
  origin: z.string().nullable(),
  purpose: z.string().nullable(),
  credentialKind: agentActivityCredentialKindSchema.nullable(),
  clientId: z.string().nullable(),
  /** The OAuth client's registered name, or an in-process host's label; null for a PAT, a session or an unknown client. */
  clientName: z.string().nullable(),
  /** A card call's stated amount, as a decimal string (`"42.50"`); absent otherwise. */
  amount: z.string().nullable().optional(),
  /** A card call's currency (ISO 4217); absent otherwise. */
  currency: z.string().nullable().optional(),
  /** A service key call's `service` (contract 1.4); absent otherwise. */
  service: z.string().nullable().optional(),
  /** A service key call's key `name` (contract 1.4); absent otherwise. */
  keyName: z.string().nullable().optional(),
});

/** @stability beta */
export type AgentActivityItem = z.infer<typeof agentActivityItemSchema>;

/** Response of `GET /api/agent-activity`. @stability beta */
export const agentActivityResponseSchema = z.object({
  data: z.array(agentActivityItemSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/** @stability beta */
export type AgentActivityResponse = z.infer<typeof agentActivityResponseSchema>;

export * from './cards-identity.js';
export * from './contract-version.js';
export * from './service-keys.js';
