import { z } from 'zod';

import { typeErrors } from '../common/index.js';
import {
  BACKUP_CONTENT_DEFAULTS,
  contentSelectionIssues,
  resolveContentSelection,
} from './backup-contents.js';

/**
 * Backups: the content selection rules, the schedule vocabulary and validators,
 * and the request schemas of the user export, the system export, the schedule
 * and the run list. Every message is static text and never echoes a submitted
 * value, so a validation error is safe to log.
 *
 * @packageDocumentation
 */

export * from './backup-contents.js';
export * from './responses.js';

/** Allowed backup frequencies. @stability experimental */
export const BACKUP_FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'] as const;

/** @stability experimental */
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** Allowed `intervalHours` for `hourly`: each divides 24, so slots repeat every day. */
export const BACKUP_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True when `value` is a valid `HH:mm` (00:00 to 23:59). */
export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

/** True when `Intl` accepts `timeZone` as an IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const EXPORT_PASSWORD_MIN_LENGTH = 6;
export const EXPORT_PASSWORD_MAX_LENGTH = 256;

const optionalBoolean = (name: string) =>
  z.boolean({ error: typeErrors({ invalid: `${name} must be a boolean` }) }).optional();

/**
 * Body of `POST /api/secrets/export`.
 *
 * The password is deliberately free-form: the product decision is "any
 * password of at least 6 characters", with no complexity rules. It is not
 * trimmed either, because a user who typed a trailing space has to type the
 * same trailing space into 7-Zip to open the file.
 *
 * Content flags (see `backup-contents.ts`): `includeSecrets` (default true),
 * `includeAttachments` (default true) and `includeVersions` (default false),
 * both of which require secrets, and `includeMedia` (default false). At least
 * one of secrets / media is required. `includeSystem` belongs to the
 * scheduled system backup only and is rejected here.
 *
 * Every message below is static text. None of them echoes the submitted value,
 * so a validation error can be logged by the exception filter without leaking
 * the password.
 */
export const exportSecretsSchema = z
  .object(
    {
      password: z
        .string({
          error: typeErrors({ required: 'Password is required', invalid: 'Password must be a string' }),
        })
        .min(
          EXPORT_PASSWORD_MIN_LENGTH,
          `Password must be at least ${EXPORT_PASSWORD_MIN_LENGTH} characters`,
        )
        .max(
          EXPORT_PASSWORD_MAX_LENGTH,
          `Password must be at most ${EXPORT_PASSWORD_MAX_LENGTH} characters`,
        ),
      includeSecrets: optionalBoolean('includeSecrets'),
      includeAttachments: optionalBoolean('includeAttachments'),
      includeVersions: optionalBoolean('includeVersions'),
      includeMedia: optionalBoolean('includeMedia'),
      // Accepted by the schema only so it can be rejected with a clear
      // message instead of being silently stripped as an unknown key.
      includeSystem: z.unknown().optional(),
    },
    {
      error: typeErrors({ required: 'Request body must be a JSON object', invalid: 'Request body must be a JSON object' }),
    },
  )
  .superRefine((value, ctx) => {
    for (const issue of contentSelectionIssues(value, 'user')) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  })
  .transform((value) => {
    const { includeSecrets, includeAttachments, includeVersions, includeMedia } =
      resolveContentSelection({ ...value, includeSystem: undefined });
    return {
      password: value.password,
      includeSecrets,
      includeAttachments,
      includeVersions,
      includeMedia,
    };
  });

export type ExportSecretsOptions = z.infer<typeof exportSecretsSchema>;

export const EXPORT_PASSWORD_CHOICE_MESSAGES = {
  missing: 'Enter a password, or use the scheduled backup password',
  both: 'Use either a password or the scheduled backup password, not both',
} as const;

/**
 * Body of `POST /api/admin/backups/export`: download a system backup now.
 *
 * Exactly one password source: `password` (6-256 characters, not trimmed,
 * same rules as the user export) or `useScheduledPassword: true` (the stored
 * schedule password, decrypted only for the stream). Content flags follow the
 * system-level rules of `backup-contents.ts`; a flag left out takes its
 * default. Every message is static and never echoes the password.
 */
export const exportSystemBackupSchema = z
  .object(
    {
      password: z
        .string({ error: typeErrors({ invalid: 'Password must be a string' }) })
        .min(
          EXPORT_PASSWORD_MIN_LENGTH,
          `Password must be at least ${EXPORT_PASSWORD_MIN_LENGTH} characters`,
        )
        .max(
          EXPORT_PASSWORD_MAX_LENGTH,
          `Password must be at most ${EXPORT_PASSWORD_MAX_LENGTH} characters`,
        )
        .optional(),
      useScheduledPassword: optionalBoolean('useScheduledPassword'),
      includeSecrets: optionalBoolean('includeSecrets'),
      includeAttachments: optionalBoolean('includeAttachments'),
      includeVersions: optionalBoolean('includeVersions'),
      includeMedia: optionalBoolean('includeMedia'),
      includeSystem: optionalBoolean('includeSystem'),
    },
    {
      error: typeErrors({ required: 'Request body must be a JSON object', invalid: 'Request body must be a JSON object' }),
    },
  )
  .superRefine((value, ctx) => {
    const scheduled = value.useScheduledPassword === true;
    if (value.password === undefined && !scheduled) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: EXPORT_PASSWORD_CHOICE_MESSAGES.missing,
      });
    }
    if (value.password !== undefined && scheduled) {
      ctx.addIssue({
        code: 'custom',
        path: ['useScheduledPassword'],
        message: EXPORT_PASSWORD_CHOICE_MESSAGES.both,
      });
    }
    for (const issue of contentSelectionIssues(value, 'system')) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  });

export const BACKUP_KEEP_COUNT_MIN = 1;
export const BACKUP_KEEP_COUNT_MAX = 365;

const nullableInt = (name: string) =>
  z
    .number({ error: typeErrors({ invalid: `${name} must be a number or null` }) })
    .int(`${name} must be an integer`)
    .nullable();

/**
 * Body of `PUT /api/admin/backups/schedule`.
 *
 * Every editable field is required (a full replace), except the content
 * flags added later (`includeSecrets` default true, `includeMedia` and
 * `includeSystem` default false), so an older client keeps working.
 * `includeAttachments` / `includeVersions` true require `includeSecrets`, and
 * at least one of secrets / media / system must be selected (see
 * `backup-contents.ts`). `password` is write-only: omitted keeps the stored
 * one, a string replaces it. As with the user export the password is
 * free-form (6-256 characters, not trimmed).
 *
 * Every message is static text and never echoes the submitted value, so a
 * validation error is safe to log.
 */
export const updateBackupScheduleSchema = z
  .object(
    {
      enabled: z.boolean({
        error: typeErrors({ required: 'enabled is required', invalid: 'enabled must be a boolean' }),
      }),
      frequency: z.enum(BACKUP_FREQUENCIES, {
        error: () => `frequency must be one of ${BACKUP_FREQUENCIES.join(', ')}`,
      }),
      intervalHours: nullableInt('intervalHours'),
      timeOfDay: z
        .string({
          error: typeErrors({ required: 'timeOfDay is required', invalid: 'timeOfDay must be a string' }),
        })
        .refine(isValidTimeOfDay, 'timeOfDay must be HH:mm (00:00 to 23:59)'),
      dayOfWeek: nullableInt('dayOfWeek'),
      dayOfMonth: nullableInt('dayOfMonth'),
      timezone: z
        .string({
          error: typeErrors({ required: 'timezone is required', invalid: 'timezone must be a string' }),
        })
        .refine(isValidTimeZone, 'timezone must be a valid IANA time zone'),
      keepCount: z
        .number({
          error: typeErrors({ required: 'keepCount is required', invalid: 'keepCount must be a number' }),
        })
        .int('keepCount must be an integer')
        .min(BACKUP_KEEP_COUNT_MIN, `keepCount must be at least ${BACKUP_KEEP_COUNT_MIN}`)
        .max(BACKUP_KEEP_COUNT_MAX, `keepCount must be at most ${BACKUP_KEEP_COUNT_MAX}`),
      includeAttachments: z.boolean({
        error: typeErrors({ required: 'includeAttachments is required', invalid: 'includeAttachments must be a boolean' }),
      }),
      includeVersions: z.boolean({
        error: typeErrors({ required: 'includeVersions is required', invalid: 'includeVersions must be a boolean' }),
      }),
      includeSecrets: z
        .boolean({ error: typeErrors({ invalid: 'includeSecrets must be a boolean' }) })
        .optional()
        .default(BACKUP_CONTENT_DEFAULTS.includeSecrets),
      includeMedia: z
        .boolean({ error: typeErrors({ invalid: 'includeMedia must be a boolean' }) })
        .optional()
        .default(BACKUP_CONTENT_DEFAULTS.includeMedia),
      includeSystem: z
        .boolean({ error: typeErrors({ invalid: 'includeSystem must be a boolean' }) })
        .optional()
        .default(BACKUP_CONTENT_DEFAULTS.includeSystem),
      password: z
        .string({ error: typeErrors({ invalid: 'Password must be a string' }) })
        .min(
          EXPORT_PASSWORD_MIN_LENGTH,
          `Password must be at least ${EXPORT_PASSWORD_MIN_LENGTH} characters`,
        )
        .max(
          EXPORT_PASSWORD_MAX_LENGTH,
          `Password must be at most ${EXPORT_PASSWORD_MAX_LENGTH} characters`,
        )
        .optional(),
    },
    {
      error: typeErrors({ required: 'Request body must be a JSON object', invalid: 'Request body must be a JSON object' }),
    },
  )
  .superRefine((value, ctx) => {
    for (const issue of contentSelectionIssues(value, 'system')) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
    if (value.frequency === 'hourly') {
      if (
        value.intervalHours === null ||
        !(BACKUP_INTERVAL_HOURS as readonly number[]).includes(value.intervalHours)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['intervalHours'],
          message: `intervalHours must be one of ${BACKUP_INTERVAL_HOURS.join(', ')} for an hourly schedule`,
        });
      }
    }
    if (value.frequency === 'weekly') {
      if (value.dayOfWeek === null || value.dayOfWeek < 0 || value.dayOfWeek > 6) {
        ctx.addIssue({
          code: 'custom',
          path: ['dayOfWeek'],
          message: 'dayOfWeek must be 0 (Sunday) to 6 for a weekly schedule',
        });
      }
    }
    if (value.frequency === 'monthly') {
      if (value.dayOfMonth === null || value.dayOfMonth < 1 || value.dayOfMonth > 28) {
        ctx.addIssue({
          code: 'custom',
          path: ['dayOfMonth'],
          message: 'dayOfMonth must be 1 to 28 for a monthly schedule',
        });
      }
    }
  });

export type UpdateBackupScheduleInput = z.infer<typeof updateBackupScheduleSchema>;

/** Query of `GET /api/admin/backups` (same paging fields as the users list). */
export const backupRunListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type BackupRunListQuery = z.infer<typeof backupRunListQuerySchema>;

