import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  BACKUP_KEEP_COUNT_MAX,
  BACKUP_KEEP_COUNT_MIN,
  EXPORT_PASSWORD_MAX_LENGTH,
  EXPORT_PASSWORD_MIN_LENGTH,
  updateBackupScheduleSchema,
  type UpdateBackupScheduleInput,
} from '@marinoscar/vault-contract/backups';

import { BACKUP_FREQUENCIES, BACKUP_INTERVAL_HOURS } from '../backup-schedule';
import { BACKUP_CONTENT_DEFAULTS } from '../../secrets/export/backup-contents';

export { BACKUP_KEEP_COUNT_MIN, BACKUP_KEEP_COUNT_MAX, updateBackupScheduleSchema };
export type { UpdateBackupScheduleInput };

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
