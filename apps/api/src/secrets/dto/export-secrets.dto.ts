import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { typeErrors } from '../../common/schemas/zod-messages';
import { createZodDto } from 'nestjs-zod';

import {
  BACKUP_CONTENT_DEFAULTS,
  contentSelectionIssues,
  resolveContentSelection,
} from '../export/backup-contents';

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
