import { z } from 'zod';

/**
 * Job types of the logical backups (E5.2, #82). PERMANENT once a row of the type exists
 * (`test/jobs/job-type-snapshot.spec.ts` pins them); a rename is a new type.
 *
 * Both are SERVER-ONLY: neither handler implements `nodeResultSchema` or
 * `persistNodeResult`, because the archive password and `VAULT_ENCRYPTION_KEY`-protected data
 * must never reach a worker node.
 *
 * Active-run uniqueness is the queue's dedup key (`buildDedupKey(type, subjectType, subjectId)`):
 * one active system backup; one active backup per user.
 */
export const BACKUP_RUN_JOB_TYPE = 'vault.backup.run';
export const USER_BACKUP_RUN_JOB_TYPE = 'vault.user_backup.run';

/** `subjectType` of a user backup job; the `subjectId` is the user id. */
export const USER_BACKUP_SUBJECT_TYPE = 'user';

/** Both backup types run up to half an hour and are never retried automatically. */
export const BACKUP_JOB_PROFILE = { maxRuntimeMs: 30 * 60_000, maxAttempts: 1 } as const;

/** Payload of `vault.backup.run`: identifiers only, never a secret. */
export const systemBackupPayloadSchema = z.object({
  trigger: z.enum(['schedule', 'manual']).optional(),
  triggeredById: z.string().uuid().nullable().optional(),
});

/**
 * Payload of `vault.user_backup.run`. `passwordEncrypted` is `CryptoService` ciphertext (the
 * JSON of `encryptBackupPassword`); the plaintext password is never in a payload. The handler
 * removes the ciphertext from the row when the run settles.
 */
export const userBackupPayloadSchema = z.object({
  ownerId: z.string().uuid(),
  selection: z.object({
    includeSecrets: z.boolean(),
    includeAttachments: z.boolean(),
    includeVersions: z.boolean(),
    includeMedia: z.boolean(),
  }),
  passwordEncrypted: z.string().optional(),
});

export type UserBackupPayload = z.infer<typeof userBackupPayloadSchema>;
