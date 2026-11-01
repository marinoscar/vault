import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const EXPORT_PASSWORD_MIN_LENGTH = 6;
export const EXPORT_PASSWORD_MAX_LENGTH = 256;

/**
 * Body of `POST /api/secrets/export`.
 *
 * The password is deliberately free-form: the product decision is "any
 * password of at least 6 characters", with no complexity rules. It is not
 * trimmed either, because a user who typed a trailing space has to type the
 * same trailing space into 7-Zip to open the file.
 *
 * Every message below is static text. None of them echoes the submitted value,
 * so a validation error can be logged by the exception filter without leaking
 * the password.
 */
export const exportSecretsSchema = z.object(
  {
    password: z
      .string({
        required_error: 'Password is required',
        invalid_type_error: 'Password must be a string',
      })
      .min(
        EXPORT_PASSWORD_MIN_LENGTH,
        `Password must be at least ${EXPORT_PASSWORD_MIN_LENGTH} characters`,
      )
      .max(
        EXPORT_PASSWORD_MAX_LENGTH,
        `Password must be at most ${EXPORT_PASSWORD_MAX_LENGTH} characters`,
      ),
    includeAttachments: z
      .boolean({ invalid_type_error: 'includeAttachments must be a boolean' })
      .optional()
      .default(true),
    includeVersions: z
      .boolean({ invalid_type_error: 'includeVersions must be a boolean' })
      .optional()
      .default(false),
  },
  {
    required_error: 'Request body must be a JSON object',
    invalid_type_error: 'Request body must be a JSON object',
  },
);

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
    includeAttachments: {
      type: 'boolean',
      default: true,
      description: 'Include attachment files (card images and other files).',
    },
    includeVersions: {
      type: 'boolean',
      default: false,
      description:
        'Include every version of each secret, not just the current one.',
    },
  },
};
