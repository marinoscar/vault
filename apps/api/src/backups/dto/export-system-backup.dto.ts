import { BadRequestException } from '@nestjs/common';
import {
  EXPORT_PASSWORD_CHOICE_MESSAGES,
  EXPORT_PASSWORD_MAX_LENGTH,
  EXPORT_PASSWORD_MIN_LENGTH,
  exportSystemBackupSchema,
} from '@marinoscar/vault-contract/backups';

import {
  BACKUP_CONTENT_DEFAULTS,
  BackupContentSelection,
  resolveContentSelection,
} from '../../secrets/export/backup-contents';

export { EXPORT_PASSWORD_CHOICE_MESSAGES, exportSystemBackupSchema };

export interface ExportSystemBackupInput {
  /** The given password, or `null` when the scheduled one is to be used. */
  password: string | null;
  useScheduledPassword: boolean;
  selection: BackupContentSelection;
}

/**
 * Validate the export body. Parsed by the route itself so a 400 carries the
 * specific first message; `details` holds field paths and static messages only.
 *
 * @throws BadRequestException on any validation failure.
 */
export function parseExportSystemBackupBody(body: unknown): ExportSystemBackupInput {
  const result = exportSystemBackupSchema.safeParse(body);
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
  const value = result.data;
  return {
    password: value.password ?? null,
    useScheduledPassword: value.useScheduledPassword === true,
    selection: resolveContentSelection(value),
  };
}

/** OpenAPI body description (hand-written, like the other backup bodies). */
export const EXPORT_SYSTEM_BACKUP_BODY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    password: {
      type: 'string',
      format: 'password',
      minLength: EXPORT_PASSWORD_MIN_LENGTH,
      maxLength: EXPORT_PASSWORD_MAX_LENGTH,
      description:
        'Password the zip is AES-256 encrypted with. Never stored or logged. Give exactly one of ' +
        'password and useScheduledPassword: true.',
    },
    useScheduledPassword: {
      type: 'boolean',
      description: 'Encrypt with the stored backup schedule password (decrypted only for this stream).',
    },
    includeSecrets: { type: 'boolean', default: BACKUP_CONTENT_DEFAULTS.includeSecrets },
    includeAttachments: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeAttachments,
      description: 'true requires includeSecrets.',
    },
    includeVersions: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeVersions,
      description: 'true requires includeSecrets.',
    },
    includeMedia: { type: 'boolean', default: BACKUP_CONTENT_DEFAULTS.includeMedia },
    includeSystem: { type: 'boolean', default: BACKUP_CONTENT_DEFAULTS.includeSystem },
  },
};
