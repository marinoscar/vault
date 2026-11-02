import { z } from 'zod';

/**
 * Secrets: create, update, list, renew, attachment and card-summary bodies and
 * queries. Request shapes only; secret values are validated against the
 * secret's type by the API.
 *
 * @packageDocumentation
 */

/**
 * Role of an attachment within its secret version. Omitted means a generic
 * attachment (stored as NULL), of which a version may have many. A
 * role-bearing attachment is unique per version.
 *
 * @stability experimental
 */
export const attachmentRoleSchema = z.enum(['card_front', 'card_back']);

/** @stability experimental */
export type AttachmentRole = z.infer<typeof attachmentRoleSchema>;

/** Body of `POST /api/secrets`. @stability experimental */
export const createSecretSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  typeId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});

/** Body of `PUT /api/secrets/:id`. @stability experimental */
export const updateSecretSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Query of `GET /api/secrets`. @stability experimental */
export const secretListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  typeId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/** @stability experimental */
export type SecretListQuery = z.infer<typeof secretListQuerySchema>;

/** Query of the card summary list. @stability experimental */
export const cardSummaryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/** @stability experimental */
export type CardSummaryQuery = z.infer<typeof cardSummaryQuerySchema>;

/** Body of `POST /api/secrets/:id/attachments`. @stability experimental */
export const linkAttachmentSchema = z.object({
  storageObjectId: z.string().uuid(),
  role: attachmentRoleSchema.optional(),
  label: z.string().max(255).optional(),
});

/**
 * Query filters for `GET /secrets/:id/attachments`.
 *
 * Both filters are optional. With no `versionId` the endpoint scopes to the
 * secret's current version: attachments are carried forward on every new
 * version, so the unscoped set would otherwise grow by a full copy per edit.
 *
 * @stability experimental
 */
export const attachmentListQuerySchema = z.object({
  versionId: z.string().uuid().optional(),
  role: attachmentRoleSchema.optional(),
});

/**
 * One file supplied with a renewal.
 *
 * Shape-identical to the link body minus the secret id, so the same client code
 * that builds a link payload can build a renewal entry. `role` stays optional:
 * a renewal may also add generic (role-less) files, which are additions rather
 * than replacements.
 *
 * @stability experimental
 */
export const renewAttachmentSchema = z.object({
  storageObjectId: z.string().uuid(),
  role: attachmentRoleSchema.optional(),
  label: z.string().max(255).optional(),
});

/** @stability experimental */
export type RenewAttachmentInput = z.infer<typeof renewAttachmentSchema>;

/** Body of `POST /api/secrets/:id/renew`. @stability experimental */
export const renewSecretSchema = z.object({
  /**
   * The full field set for the NEW card, validated against the secret's type
   * exactly as `PUT /secrets/:id` validates its `data`. This is a replacement,
   * not a merge: a reissued card carries a new number, expiry and often a new
   * name, and silently merging would leave stale fields from the dead card.
   */
  data: z.record(z.string(), z.unknown()),

  /**
   * Files that REPLACE the same-role file on the outgoing version. Anything
   * whose role is absent from this list is carried forward untouched.
   *
   * Capped so a malformed client cannot make one request fan out into thousands
   * of storage lookups. Twenty clears every realistic renewal: two card faces
   * plus supporting documents.
   */
  attachments: z.array(renewAttachmentSchema).max(20).optional(),

  /**
   * Whether the field values were extracted by the AI from a photo of the card
   * rather than typed by hand. Recorded in the audit trail only; it has NO
   * effect on validation or on what gets stored.
   */
  aiAssisted: z.boolean().optional(),
});

/**
 * A storage object as it appears inside a secret attachment on the wire.
 * `size` is a BigInt in the database and travels as a string; dates are ISO
 * strings.
 *
 * @stability experimental
 */
export const attachmentStorageObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.string(),
  mimeType: z.string(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A secret attachment as returned by the API. @stability experimental */
export const attachmentResponseSchema = z.object({
  id: z.string(),
  secretId: z.string(),
  secretVersionId: z.string(),
  storageObjectId: z.string(),
  role: z.string().nullable(),
  label: z.string().nullable(),
  createdAt: z.string(),
  storageObject: attachmentStorageObjectSchema.nullable(),
});

/** @stability experimental */
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
