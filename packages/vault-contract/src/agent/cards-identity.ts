import { z } from 'zod';

/**
 * Agent release of payment cards and identity fields (ADR-0003 of the Vault repository):
 * the agent routes under `/api/agent/v1/cards` and `/api/agent/v1/identity`, and the owner's
 * merchant grants and grant requests under `/api/secrets/:id/card-grants` and
 * `/api/secrets/:id/card-grant-requests`.
 *
 * Request and response shapes only. Behaviour (the grant rules, the kill switches, rate limits,
 * audit) is the API's. Never a value in a schema here except the one `{ value }` a fill returns.
 *
 * @packageDocumentation
 */

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------

/** The largest amount a grant or a call may carry: 10,000,000.00. @stability experimental */
export const AGENT_MAX_AMOUNT = 10_000_000;

/**
 * An amount in major units with at most two decimal places, greater than zero and at most
 * {@link AGENT_MAX_AMOUNT}. The API stores it in hundredths.
 *
 * @stability experimental
 */
export const agentAmountSchema = z
  .number()
  .positive()
  .max(AGENT_MAX_AMOUNT)
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, {
    message: 'Use at most two decimal places',
  });

/** An ISO 4217 currency code, upper case (`USD`, `EUR`). Lower case is accepted and upper-cased. @stability experimental */
export const agentCurrencySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO 4217 currency code'));

/** An amount in hundredths (the stored form). @stability experimental */
export function amountToMinor(amount: number): number {
  return Math.round(amount * 100);
}

/** Hundredths back to a major-unit number. @stability experimental */
export function minorToAmount(minor: number): number {
  return Math.round(minor) / 100;
}

/** Hundredths as a two-decimal string (`4250` is `"42.50"`), for the activity trail. @stability experimental */
export function formatMinorAmount(minor: number): string {
  return (Math.round(minor) / 100).toFixed(2);
}

const originSchema = z.string().trim().min(1).max(2048);

// -----------------------------------------------------------------------------
// Cards: the agent routes
// -----------------------------------------------------------------------------

/**
 * The one card field a fill returns. Stored field of the `Card` type each maps to:
 * `number` (number), `expMonth` (exp_month), `expYear` (exp_year), `holderName` (cardholder_name),
 * `securityCode` (cvv), `postalCode` (billing_postal_code).
 *
 * @stability experimental
 */
export const agentCardFillFieldSchema = z.enum(['number', 'expMonth', 'expYear', 'holderName', 'securityCode', 'postalCode']);

/** @stability experimental */
export type AgentCardFillField = z.infer<typeof agentCardFillFieldSchema>;

/** The stored `Card` type field behind each {@link AgentCardFillField}. @stability experimental */
export const AGENT_CARD_FIELD_MAP: Readonly<Record<AgentCardFillField, string>> = Object.freeze({
  number: 'number',
  expMonth: 'exp_month',
  expYear: 'exp_year',
  holderName: 'cardholder_name',
  securityCode: 'cvv',
  postalCode: 'billing_postal_code',
});

/** Query of `GET /api/agent/v1/cards`: the top-level page's origin (the merchant). @stability experimental */
export const agentCardsLookupQuerySchema = z.object({ origin: originSchema });

/** @stability experimental */
export type AgentCardsLookupQuery = z.infer<typeof agentCardsLookupQuerySchema>;

/** The grant a card is listed under. @stability experimental */
export const agentCardGrantSummarySchema = z.object({
  maxAmount: z.number(),
  currency: z.string(),
  includesSecurityCode: z.boolean(),
  /** ISO 8601, or null for no expiry. */
  expiresAt: z.string().nullable(),
});

/**
 * One opened card with a live grant for the asked merchant. Never a number or a code:
 * `last4` is the only part of the number, and `brand` is the stored network.
 *
 * @stability experimental
 */
export const agentCardSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.string().nullable(),
  expYear: z.string().nullable(),
  grant: agentCardGrantSummarySchema,
});

/** @stability experimental */
export type AgentCardSummary = z.infer<typeof agentCardSummarySchema>;

/** Response of `GET /api/agent/v1/cards`. @stability experimental */
export const agentCardsLookupResponseSchema = z.object({ data: z.array(agentCardSummarySchema) });

/**
 * Body of `POST /api/agent/v1/cards/:id/fill`: ONE field, the merchant's top-level origin, the
 * embedded payment frame's origin when the field is typed into one, and the purchase's amount and
 * currency (checked against the grant and recorded).
 *
 * @stability experimental
 */
export const agentCardFillRequestSchema = z.object({
  field: agentCardFillFieldSchema,
  origin: originSchema,
  frameOrigin: originSchema.optional(),
  amount: agentAmountSchema,
  currency: agentCurrencySchema,
  purpose: z.literal('purchase'),
});

/** @stability experimental */
export type AgentCardFillRequest = z.infer<typeof agentCardFillRequestSchema>;

/** Response of a card or identity fill: one value. Type it, never show it to a model or put it in a screenshot. @stability experimental */
export const agentValueResponseSchema = z.object({ data: z.object({ value: z.string() }) });

/** Body of `POST /api/agent/v1/cards/:id/grant-requests`. @stability experimental */
export const agentCardGrantRequestCreateSchema = z.object({
  origin: originSchema,
  amount: agentAmountSchema,
  currency: agentCurrencySchema,
  /** Shown to the owner. Plain text, no card data. */
  reason: z.string().trim().min(1).max(500),
});

/** @stability experimental */
export type AgentCardGrantRequestCreate = z.infer<typeof agentCardGrantRequestCreateSchema>;

/** The status of a grant request. @stability experimental */
export const cardGrantRequestStatusSchema = z.enum(['pending', 'approved', 'declined']);

/** @stability experimental */
export type CardGrantRequestStatus = z.infer<typeof cardGrantRequestStatusSchema>;

/** Response of the grant-request route: an id and a status, never card data. @stability experimental */
export const agentCardGrantRequestResponseSchema = z.object({
  data: z.object({ id: z.string().uuid(), status: cardGrantRequestStatusSchema }),
});

// -----------------------------------------------------------------------------
// Identity: the agent routes
// -----------------------------------------------------------------------------

/**
 * The fields of the `Identity` system type an agent may ask for (every field but `notes`).
 * `date_of_birth` and `id_number` are sensitive: released only to an origin on the item's
 * allowed origins.
 *
 * @stability experimental
 */
export const AGENT_IDENTITY_FIELDS = [
  'full_name',
  'date_of_birth',
  'id_type',
  'id_number',
  'id_issuing_country',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'phone',
  'email',
] as const;

/** @stability experimental */
export const agentIdentityFieldSchema = z.enum(AGENT_IDENTITY_FIELDS);

/** @stability experimental */
export type AgentIdentityField = z.infer<typeof agentIdentityFieldSchema>;

/** Query of `GET /api/agent/v1/identity`: the origin of the form. @stability experimental */
export const agentIdentityLookupQuerySchema = z.object({ origin: originSchema });

/** One field of an identity item as the lookup lists it: a label, never a value. @stability experimental */
export const agentIdentityFieldSummarySchema = z.object({
  field: agentIdentityFieldSchema,
  label: z.string(),
  sensitive: z.boolean(),
  /** Whether a fill of this field on the asked origin would be allowed (non-sensitive, or the origin is allowed). */
  fillable: z.boolean(),
});

/** One opened identity item. @stability experimental */
export const agentIdentitySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Whether the asked origin is on the item's allowed origins (sensitive fields are fillable there). */
  originAllowed: z.boolean(),
  fields: z.array(agentIdentityFieldSummarySchema),
});

/** @stability experimental */
export type AgentIdentitySummary = z.infer<typeof agentIdentitySummarySchema>;

/** Response of `GET /api/agent/v1/identity`. @stability experimental */
export const agentIdentityLookupResponseSchema = z.object({ data: z.array(agentIdentitySummarySchema) });

/** Body of `POST /api/agent/v1/identity/:id/fill`. @stability experimental */
export const agentIdentityFillRequestSchema = z.object({
  field: agentIdentityFieldSchema,
  origin: originSchema,
  purpose: z.literal('form'),
});

/** @stability experimental */
export type AgentIdentityFillRequest = z.infer<typeof agentIdentityFillRequestSchema>;

// -----------------------------------------------------------------------------
// Owner: merchant grants and grant requests (browser session only)
// -----------------------------------------------------------------------------

/** A grant's optional period limit: at most `maxReleases` and/or `maxAmount` per UTC day or month. @stability experimental */
export const cardGrantPeriodLimitSchema = z
  .object({
    period: z.enum(['day', 'month']),
    maxReleases: z.number().int().min(1).max(1_000).optional(),
    maxAmount: agentAmountSchema.optional(),
  })
  .refine((limit) => limit.maxReleases !== undefined || limit.maxAmount !== undefined, {
    message: 'Set maxReleases, maxAmount or both',
    path: ['maxReleases'],
  });

/** @stability experimental */
export type CardGrantPeriodLimit = z.infer<typeof cardGrantPeriodLimitSchema>;

/** Most payment frame origins one grant may list. @stability experimental */
export const MAX_CARD_GRANT_FRAME_ORIGINS = 10;

/** Body of `POST /api/secrets/:id/card-grants` (owner, browser session). @stability experimental */
export const createCardGrantSchema = z.object({
  merchantOrigin: originSchema,
  frameOrigins: z.array(originSchema).max(MAX_CARD_GRANT_FRAME_ORIGINS).default([]),
  maxAmount: agentAmountSchema,
  currency: agentCurrencySchema,
  periodLimit: cardGrantPeriodLimitSchema.nullable().optional(),
  /** ISO 8601 with an offset; must be in the future. */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  includeSecurityCode: z.boolean().default(false),
});

/** @stability experimental */
export type CreateCardGrant = z.input<typeof createCardGrantSchema>;

/** A grant's state: live, past its expiry, or revoked by the owner. @stability experimental */
export const cardGrantStatusSchema = z.enum(['active', 'expired', 'revoked']);

/** @stability experimental */
export type CardGrantStatus = z.infer<typeof cardGrantStatusSchema>;

/** One merchant grant as the owner sees it, with its use. @stability experimental */
export const cardGrantSchema = z.object({
  id: z.string().uuid(),
  secretId: z.string().uuid(),
  merchantOrigin: z.string(),
  /** The registrable domain requests are matched on. */
  merchantSite: z.string(),
  frameOrigins: z.array(z.string()),
  maxAmount: z.number(),
  currency: z.string(),
  periodLimit: z
    .object({ period: z.enum(['day', 'month']), maxReleases: z.number().nullable(), maxAmount: z.number().nullable() })
    .nullable(),
  expiresAt: z.string().nullable(),
  includeSecurityCode: z.boolean(),
  status: cardGrantStatusSchema,
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  usage: z.object({
    /** Releases (`number` fills) in the current period (UTC day, or month when the limit is monthly). */
    periodReleases: z.number().int(),
    /** Their total amount. */
    periodAmount: z.number(),
    totalReleases: z.number().int(),
    lastReleasedAt: z.string().nullable(),
  }),
});

/** @stability experimental */
export type CardGrant = z.infer<typeof cardGrantSchema>;

/** Response of `GET /api/secrets/:id/card-grants`: active first, then expired and revoked. @stability experimental */
export const cardGrantListResponseSchema = z.object({ data: z.array(cardGrantSchema) });

/** Query of `GET /api/secrets/:id/card-grant-requests`. @stability experimental */
export const cardGrantRequestListQuerySchema = z.object({ status: cardGrantRequestStatusSchema.optional() });

/** One grant request as the owner sees it. @stability experimental */
export const cardGrantRequestSchema = z.object({
  id: z.string().uuid(),
  secretId: z.string().uuid(),
  origin: z.string(),
  merchantSite: z.string(),
  amount: z.number(),
  currency: z.string(),
  reason: z.string(),
  status: cardGrantRequestStatusSchema,
  /** The asking app: an OAuth client's name, an in-process host's label, or `Personal access token`. */
  clientName: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  /** The grant an approval created. */
  grantId: z.string().nullable(),
});

/** @stability experimental */
export type CardGrantRequest = z.infer<typeof cardGrantRequestSchema>;

/** Response of the grant-request list, newest first. @stability experimental */
export const cardGrantRequestListResponseSchema = z.object({ data: z.array(cardGrantRequestSchema) });

/** The owner's audit actions on grants (`audit_events.action`). @stability experimental */
export const CARD_GRANT_AUDIT_ACTIONS = {
  CREATE: 'secret.card_grant.create',
  REVOKE: 'secret.card_grant.revoke',
  APPROVE: 'secret.card_grant_request.approve',
  DECLINE: 'secret.card_grant_request.decline',
} as const;

/** @stability experimental */
export type CardGrantAuditAction = (typeof CARD_GRANT_AUDIT_ACTIONS)[keyof typeof CARD_GRANT_AUDIT_ACTIONS];
