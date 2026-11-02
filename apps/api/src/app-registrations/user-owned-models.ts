// =============================================================================
// Vault's user-owned models (issue #77, E3.2)
// =============================================================================
//
// Every Vault model with a foreign key to `User`, classified for the platform's
// user-data machinery (the scoped client, the user-data purge planner and export,
// and the `user-owned-data` conformance suite, which fails when this list and
// `prisma/schema/` disagree).
//
// PURGE FOLLOWS `onDelete`: `Cascade` is `delete`, `SetNull` is `detach`.
//
// SECRET MATERIAL NEVER TAKES THE GENERIC EXPORT. `Secret` and `SecretVersion`
// are `exclude`: a secret leaves the deployment only through Vault's own
// password-protected export (`POST /api/secrets/export`), never through a
// plaintext data download. The `vault-secrets` export source (E9.3,
// `platform/exports/vault-secrets.source.ts`) adds secret METADATA (names, types,
// timestamps, counts) by an explicit column list; it reads no value and no ciphertext.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { UserOwnedModelDef } from '@marinoscar/platform-api/core';

export const VAULT_USER_OWNED_MODELS: readonly UserOwnedModelDef<Prisma.ModelName>[] = [
  {
    model: 'MediaFolder',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "A media folder belongs to the user who created it: deleted with the user and part of the user's data.",
  },
  {
    model: 'Secret',
    ownerField: 'createdById',
    ownerRelation: 'createdBy',
    purge: 'detach',
    export: 'exclude',
    rationale:
      'A secret survives its creator (created_by_id is set null); its values leave only through the encrypted Vault export.',
  },
  {
    model: 'SecretVersion',
    actorFields: ['createdById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'An immutable ciphertext version: records who wrote it, never exported in plaintext.',
  },
  {
    model: 'SecretType',
    ownerField: 'createdById',
    ownerRelation: 'createdBy',
    purge: 'detach',
    export: 'include',
    rationale:
      'A custom secret type is shared configuration: it survives its author (created_by_id is set null). The author ' +
      'owns it for the Danger Zone (deleted when no secret uses it, by the vault.user_data.purge delegate) and for the ' +
      'export (a type is a list of field names and kinds, never a value). System types have no author.',
  },
  {
    model: 'BackupRun',
    ownerField: 'ownerId',
    ownerRelation: 'owner',
    actorFields: ['triggeredById'],
    purge: 'delete',
    export: 'exclude',
    rationale:
      'A user backup run belongs to the user it was made for (deleted with them); the archive itself is the export.',
  },
  {
    model: 'BackupSchedule',
    actorFields: ['updatedById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'The one system backup schedule records which administrator last changed it.',
  },
];
