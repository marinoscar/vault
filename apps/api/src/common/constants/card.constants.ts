// =============================================================================
// Card Constants
// =============================================================================
// Single source of truth for card option values, shared by the secret-type
// seed data and the OpenAI JSON schema used for card extraction.

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

export type CardNetwork = (typeof CARD_NETWORKS)[number];

export const CARD_KINDS = ['Credit', 'Debit', 'Prepaid', 'Other'] as const;

export type CardKind = (typeof CARD_KINDS)[number];
