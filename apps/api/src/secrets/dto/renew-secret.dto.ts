import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

import { attachmentRoleSchema } from './link-attachment.dto';

/**
 * One file supplied with a renewal.
 *
 * Shape-identical to {@link LinkAttachmentDto} minus the secret id, so the same
 * client code that builds a link payload can build a renewal entry. `role` stays
 * optional: a renewal may also add generic (role-less) files — a fresh scan of
 * the terms that shipped with the reissued card, say — and those are additions
 * rather than replacements.
 */
export const renewAttachmentSchema = z.object({
  storageObjectId: z.string().uuid(),
  role: attachmentRoleSchema.optional(),
  label: z.string().max(255).optional(),
});

export type RenewAttachmentInput = z.infer<typeof renewAttachmentSchema>;

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
   * of storage lookups (each entry costs a StorageObject read, and each card
   * face may cost a bounded read-back from the storage provider). Twenty clears
   * every realistic renewal — two card faces plus supporting documents.
   */
  attachments: z.array(renewAttachmentSchema).max(20).optional(),

  /**
   * Whether the field values were extracted by the AI from a photo of the card
   * rather than typed by hand. Recorded in the audit trail so an AI-assisted
   * renewal is distinguishable from a manual one after the fact; it has NO
   * effect on validation or on what gets stored.
   */
  aiAssisted: z.boolean().optional(),
});

export class RenewSecretDto extends createZodDto(renewSecretSchema) {}
