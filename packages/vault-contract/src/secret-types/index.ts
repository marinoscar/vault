import { z } from 'zod';

import { ID_DOCUMENT_KINDS } from './id-documents.js';
import { SERVICE_KEY_TYPE_NAME } from './service-keys.js';

export * from './id-documents.js';
export * from './service-keys.js';

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

/** Government id kinds of the Identity type. @stability experimental */
export const IDENTITY_ID_TYPES = ['Passport', 'National ID', 'Driver Licence', 'Tax ID', 'Other'] as const;

/** @stability experimental */
export type IdentityIdType = (typeof IDENTITY_ID_TYPES)[number];

/**
 * The field types a secret type may declare. `keyvalue` holds a list of
 * {@link KeyValueEntry} rows and is reserved for system types: the create and
 * update schemas of a custom type reject it.
 *
 * @stability experimental
 */
export const FIELD_TYPES = ['string', 'number', 'date', 'select', 'keyvalue'] as const;

/** @stability experimental */
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Display and input formats of a `string` field. `country` takes an ISO 3166-1
 * alpha-3 code (the code a passport's MRZ prints), stored upper-case;
 * `multiline` renders a multi-line input. Neither changes the stored type.
 *
 * @stability experimental
 */
export const FIELD_FORMATS = ['country', 'multiline'] as const;

/** @stability experimental */
export type FieldFormat = (typeof FIELD_FORMATS)[number];

/**
 * Display masks of a sensitive `string` field. `last4` shows only the last four
 * characters while the value is hidden. Display only: the value is stored whole.
 *
 * @stability experimental
 */
export const FIELD_MASKS = ['last4'] as const;

/** @stability experimental */
export type FieldMask = (typeof FIELD_MASKS)[number];

/** Message of the create and update schemas when a custom type declares a `keyvalue` field. @stability experimental */
export const KEYVALUE_RESERVED_MESSAGE = 'keyvalue fields are reserved for system types';

/** Most entries a `keyvalue` value may hold. @stability experimental */
export const KEYVALUE_MAX_ENTRIES = 50;

/**
 * One row of a `keyvalue` field value: a snake_case `key`, the label shown to
 * the owner, the value and whether the value is sensitive (hidden and withheld
 * like a sensitive field).
 *
 * @stability experimental
 */
export const keyValueEntrySchema = z.object({
  key: z
    .string()
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Entry key must be snake_case'),
  label: z.string().min(1).max(100),
  value: z.string().max(2000),
  sensitive: z.boolean(),
});

/** @stability experimental */
export type KeyValueEntry = z.infer<typeof keyValueEntrySchema>;

/**
 * The value of a `keyvalue` field: at most {@link KEYVALUE_MAX_ENTRIES} entries
 * with unique keys.
 *
 * @stability experimental
 */
export const keyValueValueSchema = z
  .array(keyValueEntrySchema)
  .max(KEYVALUE_MAX_ENTRIES, `At most ${KEYVALUE_MAX_ENTRIES} entries are allowed`)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length,
    { message: 'Entry keys must be unique' },
  );

/** @stability experimental */
export type KeyValueValue = z.infer<typeof keyValueValueSchema>;

const fieldDefinitionBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Field name must be snake_case'),
  label: z.string().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  sensitive: z.boolean().default(false),
  /** Input and display format; only on `string` fields. @stability experimental */
  format: z.enum(FIELD_FORMATS).optional(),
  /** Display mask; only on sensitive `string` fields. @stability experimental */
  mask: z.enum(FIELD_MASKS).optional(),
  /**
   * Allowed values for `select` fields. Required (and only permitted) when
   * `type === 'select'`.
   */
  options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
});

/** One field of a custom secret type. @stability experimental */
export const fieldDefinitionSchema = fieldDefinitionBaseSchema.superRefine((field, ctx) => {
  if (field.format !== undefined && field.type !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['format'],
      message: 'format is only allowed for string fields',
    });
  }

  if (field.mask !== undefined && (field.type !== 'string' || field.sensitive !== true)) {
    ctx.addIssue({
      code: 'custom',
      path: ['mask'],
      message: 'mask is only allowed for sensitive string fields',
    });
  }

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

/**
 * The `fields` of a custom type: {@link secretTypeFieldsSchema} without
 * `keyvalue` fields, which are reserved for system types.
 */
const customSecretTypeFieldsSchema = secretTypeFieldsSchema.superRefine((fields, ctx) => {
  fields.forEach((field, index) => {
    if (field.type === 'keyvalue') {
      ctx.addIssue({ code: 'custom', path: [index, 'type'], message: KEYVALUE_RESERVED_MESSAGE });
    }
  });
});

/** Body of `POST /api/secret-types`. Rejects `keyvalue` fields. @stability experimental */
export const createSecretTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  fields: customSecretTypeFieldsSchema,
  allowAttachments: z.boolean().default(false),
});

/** Body of `PATCH /api/secret-types/:id`. Rejects `keyvalue` fields. @stability experimental */
export const updateSecretTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  fields: customSecretTypeFieldsSchema.optional(),
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
  type: FieldType;
  required: boolean;
  sensitive: boolean;
  options?: readonly string[];
  /** Only on `string` fields. @stability experimental */
  format?: FieldFormat;
  /** Only on sensitive `string` fields. @stability experimental */
  mask?: FieldMask;
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
      // Appended (add-only rule). Separated by whitespace, commas or semicolons (the catalog has no multi-line type or help text); feeds `secrets.origins` (see originsFromCredential).
      { name: 'additional_urls', label: 'Additional URLs (space or comma separated)', type: 'string', required: false, sensitive: false },
      // Appended (add-only rule). An otpauth://totp URI or a bare base32 seed; normalized to the canonical URI on save (see normalizeTotpSecret).
      { name: 'totp', label: 'Authenticator key (TOTP)', type: 'string', required: false, sensitive: true },
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
      // Appended (add-only rule, ADR-0003): the postal code of the billing address, released to an agent as `postalCode`.
      { name: 'billing_postal_code', label: 'Billing Postal Code', type: 'string', required: false, sensitive: false },
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
    // ADR-0003: a person's identity details for forms. `date_of_birth` and `id_number` are sensitive:
    // an agent receives them only on an origin the owner allowed for the item.
    name: 'Identity',
    description: 'Identity details for forms: legal name, date of birth, a government id, address and phone',
    icon: 'Badge',
    fields: [
      { name: 'full_name', label: 'Full Legal Name', type: 'string', required: true, sensitive: false },
      { name: 'date_of_birth', label: 'Date of Birth', type: 'date', required: false, sensitive: true },
      { name: 'id_type', label: 'ID Type', type: 'select', required: false, sensitive: false, options: [...IDENTITY_ID_TYPES] },
      { name: 'id_number', label: 'ID Number', type: 'string', required: false, sensitive: true },
      { name: 'id_issuing_country', label: 'ID Issuing Country', type: 'string', required: false, sensitive: false },
      { name: 'address_line1', label: 'Address Line 1', type: 'string', required: false, sensitive: false },
      { name: 'address_line2', label: 'Address Line 2', type: 'string', required: false, sensitive: false },
      { name: 'city', label: 'City', type: 'string', required: false, sensitive: false },
      { name: 'region', label: 'State / Province / Region', type: 'string', required: false, sensitive: false },
      { name: 'postal_code', label: 'Postal Code', type: 'string', required: false, sensitive: false },
      { name: 'country', label: 'Country', type: 'string', required: false, sensitive: false },
      { name: 'phone', label: 'Phone', type: 'string', required: false, sensitive: false },
      { name: 'email', label: 'Email', type: 'string', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
    ],
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
  {
    // ADR-0004: a passport, with the data page and back as image slots. Never released to agents or MCP.
    name: 'Passport',
    description: 'Passport details and data page photo',
    icon: 'TravelExplore',
    fields: [
      { name: 'surname', label: 'Surname', type: 'string', required: true, sensitive: false },
      { name: 'given_names', label: 'Given Names', type: 'string', required: false, sensitive: false },
      { name: 'passport_number', label: 'Passport Number', type: 'string', required: true, sensitive: true, mask: 'last4' },
      { name: 'passport_type', label: 'Type', type: 'string', required: false, sensitive: false },
      { name: 'issuing_country', label: 'Issuing Country', type: 'string', required: false, sensitive: false, format: 'country' },
      { name: 'nationality', label: 'Nationality', type: 'string', required: false, sensitive: false, format: 'country' },
      { name: 'date_of_birth', label: 'Date of Birth', type: 'date', required: false, sensitive: true },
      { name: 'place_of_birth', label: 'Place of Birth', type: 'string', required: false, sensitive: false },
      { name: 'sex', label: 'Sex', type: 'select', required: false, sensitive: false, options: ['M', 'F', 'X'] },
      { name: 'issue_date', label: 'Date of Issue', type: 'date', required: false, sensitive: false },
      { name: 'expiry_date', label: 'Date of Expiry', type: 'date', required: true, sensitive: false },
      { name: 'issuing_authority', label: 'Authority', type: 'string', required: false, sensitive: false },
      { name: 'personal_number', label: 'Personal Number', type: 'string', required: false, sensitive: true },
      { name: 'mrz', label: 'Machine Readable Zone', type: 'string', required: false, sensitive: true, format: 'multiline' },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false, format: 'multiline' },
    ],
    allowAttachments: true,
  },
  {
    // ADR-0004: every other identity document; `document_kind` picks a kind of ID_DOCUMENT_KIND_CATALOG and
    // `attributes` holds its kind-specific details. Never released to agents or MCP.
    name: 'ID Document',
    description: 'Driver license, ID card, Green Card, Global Entry, Social Security, insurance and other ID documents',
    icon: 'AssignmentInd',
    fields: [
      { name: 'document_kind', label: 'Document Kind', type: 'select', required: true, sensitive: false, options: [...ID_DOCUMENT_KINDS] },
      { name: 'holder_name', label: 'Holder Name', type: 'string', required: true, sensitive: false },
      { name: 'document_number', label: 'Document Number', type: 'string', required: false, sensitive: true, mask: 'last4' },
      { name: 'issuing_country', label: 'Issuing Country', type: 'string', required: false, sensitive: false, format: 'country' },
      { name: 'issuing_authority', label: 'Issuing Authority / State', type: 'string', required: false, sensitive: false },
      { name: 'date_of_birth', label: 'Date of Birth', type: 'date', required: false, sensitive: true },
      { name: 'issue_date', label: 'Issue Date', type: 'date', required: false, sensitive: false },
      { name: 'expiry_date', label: 'Expiry Date', type: 'date', required: false, sensitive: false },
      { name: 'attributes', label: 'Details', type: 'keyvalue', required: false, sensitive: false },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false, format: 'multiline' },
    ],
    allowAttachments: true,
  },
  {
    // Issue #241: a key of an outside service (a web search provider's API key) that a server process
    // reads by `service` and `key_name` through the agent API. No website: it is never typed into a page.
    name: SERVICE_KEY_TYPE_NAME,
    description: 'A key of an outside service that your apps call for you, read by service and key name',
    icon: 'Api',
    fields: [
      { name: 'service', label: 'Service (for example web_search)', type: 'string', required: true, sensitive: false },
      { name: 'key_name', label: 'Key name (for example provider_a)', type: 'string', required: true, sensitive: false },
      { name: 'key', label: 'Key', type: 'string', required: true, sensitive: true },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false, format: 'multiline' },
    ],
    allowAttachments: false,
  },
];
