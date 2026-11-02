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
//
// The definitions now live in `@marinoscar/vault-contract/secret-types` (E12.1);
// this file keeps the import path of prisma/seed.ts and the unit tests.

export {
  SYSTEM_SECRET_TYPES,
  type SecretTypeField,
  type SystemSecretType,
} from '@marinoscar/vault-contract/secret-types';
