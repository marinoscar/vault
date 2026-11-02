import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  EXPORT_PASSWORD_MAX_LENGTH,
  EXPORT_PASSWORD_MIN_LENGTH,
} from '../../secrets/dto/export-secrets.dto';
import {
  BACKUP_CONTENT_DEFAULTS,
  BackupContentSelection,
  contentSelectionIssues,
  resolveContentSelection,
} from '../../secrets/export/backup-contents';

export const EXPORT_PASSWORD_CHOICE_MESSAGES = {
  missing: 'Enter a password, or use the scheduled backup password',
  both: 'Use either a password or the scheduled backup password, not both',
} as const;

const optionalBoolean = (name: string) =>
  z.boolean({ invalid_type_error: `${name} must be a boolean` }).optional();

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
        .string({ invalid_type_error: 'Password must be a string' })
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
      required_error: 'Request body must be a JSON object',
      invalid_type_error: 'Request body must be a JSON object',
    },
  )
  .superRefine((value, ctx) => {
    const scheduled = value.useScheduledPassword === true;
    if (value.password === undefined && !scheduled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: EXPORT_PASSWORD_CHOICE_MESSAGES.missing,
      });
    }
    if (value.password !== undefined && scheduled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['useScheduledPassword'],
        message: EXPORT_PASSWORD_CHOICE_MESSAGES.both,
      });
    }
    for (const issue of contentSelectionIssues(value, 'system')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  });

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
