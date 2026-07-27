// =============================================================================
// System Secret Type Definitions
// =============================================================================
// Single source of truth for the built-in (isSystem: true) secret types.
// Imported by prisma/seed.ts to create/update these rows, and by unit tests
// (CI has no database and never runs the seed, so this must be plain,
// importable data with no Prisma Client dependency).
//
// IMPORTANT: fields are append-only. `validateDataAgainstType` rejects
// unknown keys, so removing or renaming a field here would make every
// existing secret of that type permanently unsaveable. Only add fields, and
// only add them as `required: false` unless every existing secret of that
// type is guaranteed to already have a value for it.

import { CARD_NETWORKS, CARD_KINDS } from '../src/common/constants/card.constants';

export interface SecretTypeField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'select';
  required: boolean;
  sensitive: boolean;
  options?: readonly string[];
}

export interface SystemSecretType {
  name: string;
  description: string;
  icon: string;
  fields: SecretTypeField[];
  allowAttachments: boolean;
}

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
