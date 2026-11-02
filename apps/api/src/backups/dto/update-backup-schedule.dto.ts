import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { typeErrors } from '../../common/schemas/zod-messages';
import { createZodDto } from 'nestjs-zod';

import {
  EXPORT_PASSWORD_MAX_LENGTH,
  EXPORT_PASSWORD_MIN_LENGTH,
} from '../../secrets/dto/export-secrets.dto';
import {
  BACKUP_FREQUENCIES,
  BACKUP_INTERVAL_HOURS,
  isValidTimeOfDay,
  isValidTimeZone,
} from '../backup-schedule';
import {
  BACKUP_CONTENT_DEFAULTS,
  contentSelectionIssues,
} from '../../secrets/export/backup-contents';

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

export class UpdateBackupScheduleDto extends createZodDto(updateBackupScheduleSchema) {}

/**
 * Validate the schedule body. Parsed by the route itself (like the user
 * export) so the 400 carries the specific first message; `details` holds only
 * field paths and static messages, never a received value.
 *
 * @throws BadRequestException on any validation failure.
 */
export function parseUpdateBackupScheduleBody(body: unknown): UpdateBackupScheduleInput {
  const result = updateBackupScheduleSchema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new BadRequestException({
      message: issues[0]?.message ?? 'Validation failed',
      details: issues,
    });
  }
  return result.data;
}

/** OpenAPI body description (hand-written: createZodDto documents as empty). */
export const UPDATE_BACKUP_SCHEDULE_BODY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: [
    'enabled',
    'frequency',
    'intervalHours',
    'timeOfDay',
    'dayOfWeek',
    'dayOfMonth',
    'timezone',
    'keepCount',
    'includeAttachments',
    'includeVersions',
  ],
  properties: {
    enabled: { type: 'boolean' },
    frequency: { type: 'string', enum: [...BACKUP_FREQUENCIES] },
    intervalHours: {
      type: 'integer',
      nullable: true,
      enum: [...BACKUP_INTERVAL_HOURS, null],
      description: 'Required for hourly: run every N hours on the hour, counted from local midnight.',
    },
    timeOfDay: {
      type: 'string',
      pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
      example: '03:00',
      description: 'HH:mm local time, used by daily, weekly and monthly.',
    },
    dayOfWeek: {
      type: 'integer',
      nullable: true,
      minimum: 0,
      maximum: 6,
      description: 'Required for weekly. 0 = Sunday.',
    },
    dayOfMonth: {
      type: 'integer',
      nullable: true,
      minimum: 1,
      maximum: 28,
      description: 'Required for monthly.',
    },
    timezone: { type: 'string', example: 'America/Chicago', description: 'IANA time zone.' },
    keepCount: {
      type: 'integer',
      minimum: BACKUP_KEEP_COUNT_MIN,
      maximum: BACKUP_KEEP_COUNT_MAX,
      description: 'How many successful backups to keep; older ones are deleted after a successful run.',
    },
    includeSecrets: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeSecrets,
      description:
        "Every user's secrets (users/NNNN/secrets.*). At least one of includeSecrets, includeMedia " +
        'and includeSystem must be true ("Choose at least one thing to back up").',
    },
    includeAttachments: {
      type: 'boolean',
      description: 'Attachment files. true requires includeSecrets (400 otherwise).',
    },
    includeVersions: {
      type: 'boolean',
      description: 'Every version of each secret. true requires includeSecrets (400 otherwise).',
    },
    includeMedia: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeMedia,
      description: "Every user's media library (users/NNNN/media/).",
    },
    includeSystem: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeSystem,
      description:
        'System configuration (system/): users and roles, allowlist, custom secret types and the ' +
        'redacted system settings. Never tokens, keys, credentials or passwords.',
    },
    password: {
      type: 'string',
      format: 'password',
      minLength: EXPORT_PASSWORD_MIN_LENGTH,
      maxLength: EXPORT_PASSWORD_MAX_LENGTH,
      description:
        'Write-only. Omit to keep the stored password; a string replaces it. Stored encrypted, never returned, ' +
        'and cannot be recovered: without it the backups cannot be opened.',
    },
  },
};
