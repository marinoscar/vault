import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  EXPORT_PASSWORD_MAX_LENGTH,
  EXPORT_PASSWORD_MIN_LENGTH,
  exportSecretsSchema,
  type ExportSecretsOptions,
} from '@marinoscar/vault-contract/backups';

import { BACKUP_CONTENT_DEFAULTS } from '../export/backup-contents';

export { EXPORT_PASSWORD_MIN_LENGTH, EXPORT_PASSWORD_MAX_LENGTH, exportSecretsSchema };
export type { ExportSecretsOptions };

export class ExportSecretsDto extends createZodDto(exportSecretsSchema) {}

/**
 * Validate the export body and return the parsed options.
 *
 * The route parses the body itself instead of relying on the global
 * `ZodValidationPipe`, because that pipe reports every failure as the generic
 * "Validation failed" and the contract requires the specific first message
 * (e.g. "Password must be at least 6 characters"). `details` carries only the
 * field path and the static message of each issue, never the received value.
 *
 * @throws BadRequestException on any validation failure.
 */
export function parseExportSecretsBody(body: unknown): ExportSecretsOptions {
  const result = exportSecretsSchema.safeParse(body);

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

/**
 * OpenAPI body description.
 *
 * Written by hand because `patchNestJsSwagger()` is not installed in this
 * application - a `createZodDto` class is otherwise documented as an empty
 * schema.
 */
export const EXPORT_SECRETS_BODY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['password'],
  properties: {
    password: {
      type: 'string',
      format: 'password',
      minLength: EXPORT_PASSWORD_MIN_LENGTH,
      maxLength: EXPORT_PASSWORD_MAX_LENGTH,
      description:
        'Password the zip is AES-256 encrypted with. Never stored or logged; ' +
        'there is no way to recover it.',
    },
    includeSecrets: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeSecrets,
      description:
        'Include the secrets you own (secrets.html, secrets.json). At least one of includeSecrets ' +
        'and includeMedia must be true ("Choose at least one thing to back up").',
    },
    includeAttachments: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeAttachments,
      description:
        'Include attachment files (card images and other files). Requires includeSecrets: ' +
        'true together with includeSecrets: false is a 400.',
    },
    includeVersions: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeVersions,
      description:
        'Include every version of each secret, not just the current one. Requires includeSecrets.',
    },
    includeMedia: {
      type: 'boolean',
      default: BACKUP_CONTENT_DEFAULTS.includeMedia,
      description:
        'Include your media library: the ready files of the media folders you own, under media/.',
    },
  },
};
