// =============================================================================
// Card Constants
// =============================================================================
// Single source of truth for card option values, shared by the secret-type
// seed data and the OpenAI JSON schema used for card extraction. They live in
// `@marinoscar/vault-contract/secret-types`; this file keeps the old import path.

export {
  CARD_NETWORKS,
  CARD_KINDS,
  type CardNetwork,
  type CardKind,
} from '@marinoscar/vault-contract/secret-types';
