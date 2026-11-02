import { z } from 'zod';

/**
 * Secret types: the field definitions, the create/update/query schemas and the
 * built-in (system) type definitions. Plain data and Zod: no database access.
 *
 * @packageDocumentation
 */

/** Card network options of the Card type and of card extraction. @stability experimental */
export const CARD_NETWORKS = [
  'Visa',
  'Mastercard',
  'American Express',
  'Discover',
  'Diners Club',
  'JCB',
  'UnionPay',
  'Maestro',
  'RuPay',
  'Elo',
  'Hipercard',
  'Other',
] as const;

/** @stability experimental */
export type CardNetwork = (typeof CARD_NETWORKS)[number];

/** Card kind options of the Card type and of card extraction. @stability experimental */
export const CARD_KINDS = ['Credit', 'Debit', 'Prepaid', 'Other'] as const;

/** @stability experimental */
export type CardKind = (typeof CARD_KINDS)[number];

const fieldDefinitionBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field name must be snake_case'),
  label: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'date', 'select']),
  required: z.boolean(),
  sensitive: z.boolean().default(false),
  /**
   * Allowed values for `select` fields. Required (and only permitted) when
   * `type === 'select'`.
   */
  options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
});

/** One field of a custom secret type. @stability experimental */
export const fieldDefinitionSchema = fieldDefinitionBaseSchema.superRefine((field, ctx) => {
  if (field.type === 'select') {
    if (!field.options || field.options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options is required for select fields',
      });
      return;
    }

    if (new Set(field.options).size !== field.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options must not contain duplicate values',
      });
    }
    return;
  }

  if (field.options !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'options is only allowed for select fields',
    });
  }
});

/** @stability experimental */
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

/**
 * Shared `fields` array schema used by both create and update bodies so the two
 * can never drift.
 *
 * @stability experimental
 */
export const secretTypeFieldsSchema = z
  .array(fieldDefinitionSchema)
  .min(1, 'At least one field is required')
  .refine(
    (fields) => {
      const names = fields.map((f) => f.name);
      return new Set(names).size === names.length;
    },
    { message: 'Field names must be unique' },
  );

/** Body of `POST /api/secret-types`. @stability experimental */
export const createSecretTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  fields: secretTypeFieldsSchema,
  allowAttachments: z.boolean().default(false),
});

/** Body of `PATCH /api/secret-types/:id`. @stability experimental */
export const updateSecretTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  fields: secretTypeFieldsSchema.optional(),
  allowAttachments: z.boolean().optional(),
});

/** Query of `GET /api/secret-types`. @stability experimental */
export const secretTypeQuerySchema = z.object({
  search: z.string().optional(),
  includeSystem: z.coerce.boolean().default(true),
});

/** @stability experimental */
export type SecretTypeQuery = z.infer<typeof secretTypeQuerySchema>;

/**
 * A field of a system secret type, as seeded. `fields` are append-only: removing
 * or renaming one would make every existing secret of that type unsaveable.
 *
 * @stability experimental
 */
export interface SecretTypeField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'select';
  required: boolean;
  sensitive: boolean;
  options?: readonly string[];
}

/** A built-in (`isSystem: true`) secret type definition. @stability experimental */
export interface SystemSecretType {
  name: string;
  description: string;
  icon: string;
  fields: SecretTypeField[];
  allowAttachments: boolean;
}

/**
 * Single source of truth for the built-in (`isSystem: true`) secret types,
 * imported by the seed and by tests.
 *
 * IMPORTANT: fields are append-only. `validateDataAgainstType` rejects unknown
 * keys, so removing or renaming a field here would make every existing secret
 * of that type permanently unsaveable. Only add fields, and only as
 * `required: false` unless every existing secret of that type is guaranteed to
 * already have a value for it.
 *
 * @stability experimental
 */
export const SYSTEM_SECRET_TYPES: SystemSecretType[] = [
  {
    name: 'Credential',
    description: 'Username and password credentials',
    icon: 'Key',
    fields: [
      { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
      { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
      { name: 'url', label: 'URL', type: 'string', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
    allowAttachments: false,
  },
  {
    name: 'API Key',
    description: 'API keys and access tokens',
    icon: 'VpnKey',
    fields: [
      { name: 'key', label: 'API Key', type: 'string', required: true, sensitive: true },
      { name: 'provider', label: 'Provider', type: 'string', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
    allowAttachments: false,
  },
  {
    name: 'Card',
    description: 'Credit or debit card information',
    icon: 'CreditCard',
    fields: [
      // card_network / card_kind MUST stay required: false — a required field
      // would break the next edit of every pre-existing card secret, and
      // back-filling is impossible because values are encrypted per version.
      {
        name: 'card_network',
        label: 'Card Company / Network',
        type: 'select',
        required: false,
        sensitive: false,
        options: [...CARD_NETWORKS],
      },
      {
        name: 'card_kind',
        label: 'Card Type',
        type: 'select',
        required: false,
        sensitive: false,
        options: [...CARD_KINDS],
      },
      { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
      { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
      { name: 'exp_month', label: 'Expiration Month', type: 'string', required: true, sensitive: false },
      { name: 'exp_year', label: 'Expiration Year', type: 'string', required: true, sensitive: false },
      { name: 'cvv', label: 'CVV / CVC', type: 'string', required: true, sensitive: true },
      {
        name: 'security_code_2',
        label: 'Secondary Security Code (CID / control number)',
        type: 'string',
        required: false,
        sensitive: true,
      },
      { name: 'issuing_bank', label: 'Issuing Bank', type: 'string', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
    allowAttachments: true,
  },
  {
    name: 'Token',
    description: 'Authentication tokens',
    icon: 'Token',
    fields: [
      { name: 'token', label: 'Token', type: 'string', required: true, sensitive: true },
      { name: 'provider', label: 'Provider', type: 'string', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
    allowAttachments: false,
  },
  {
    name: 'Note',
    description: 'Secure notes',
    icon: 'Description',
    fields: [{ name: 'content', label: 'Content', type: 'string', required: true, sensitive: false }],
    allowAttachments: false,
  },
  {
    name: 'Document',
    description: 'Documents with file attachments',
    icon: 'AttachFile',
    fields: [
      { name: 'title', label: 'Title', type: 'string', required: true, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
    allowAttachments: true,
  },
];
