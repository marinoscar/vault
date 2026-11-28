// =============================================================================
// How the Vault models are classified for the platform's user-data machinery (issue #194)
// =============================================================================
//
// Moved from apps/api/src/app-registrations (E3.2, issue #77) so every host registers the SAME
// classification: `registerPlatformUserOwnedModels(VAULT_USER_OWNED_MODELS)` and
// `registerPlatformModelOwnership(VAULT_MODEL_OWNERSHIP)`, next to its own models. The platform's
// `user-owned-data` conformance suite fails on a model of the composed schema that no list names.
//
// PURGE FOLLOWS `onDelete`: `Cascade` is `delete`, `SetNull` is `detach`.
//
// SECRET MATERIAL NEVER TAKES THE GENERIC EXPORT. `Secret` and `SecretVersion` are `exclude`: a
// secret leaves the deployment only through the password-protected export
// (`POST /api/secrets/export`), never through a plaintext data download.
//
// Vault content belongs to a USER, not to an organization: the org-isolated models are the
// platform's (`StorageObject` and its chunks, ...). `MediaFolderFile` carries an `org_id` only as the
// second half of the composite key to its storage object, so it names it as a reference.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { ModelOwnershipDef, UserOwnedModelDef } from '@marinoscar/platform-api/core';

/** Every Vault model with a foreign key to `User`. @stability experimental */
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
  },  {
    model: 'AgentCardGrant',
    ownerField: 'userId',
    ownerRelation: 'user',
    purge: 'delete',
    export: 'exclude',
    rationale:
      'A merchant grant (ADR-0003) is the owner\'s permission for agents to use one of their cards at a shop: deleted with ' +
      'the user (and with the card). Not exported: it is access configuration tied to this deployment\'s cards, like the ' +
      'agent-access flag.',
  },
  {
    model: 'AgentCardGrantRequest',
    ownerField: 'userId',
    ownerRelation: 'user',
    purge: 'delete',
    export: 'exclude',
    rationale:
      'An agent\'s request that the owner allow a card at a shop (ADR-0003): deleted with the user and with the card; holds ' +
      'no card data. Not exported (transient approval workflow).',
  },
  {
    model: 'BrokerToken',
    ownerField: 'userId',
    ownerRelation: 'user',
    purge: 'delete',
    export: 'exclude',
    rationale:
      'A credential broker token (ADR-0006) is the owner\'s delegated authority to use their keys through the broker: deleted ' +
      'with the user (ON DELETE CASCADE). Not exported: it holds only a SHA-256 of a token that was shown once, which is no ' +
      'use in another deployment.',
  },
];

/** Every Vault model's ownership kind. @stability experimental */
export const VAULT_MODEL_OWNERSHIP: readonly ModelOwnershipDef<Prisma.ModelName>[] = [
  { model: 'MediaFolder', kind: 'user', rationale: 'A media folder belongs to the user who created it.' },
  {
    model: 'MediaFolderFile',
    kind: 'system',
    orgReference: 'orgId',
    rationale:
      'Side table placing a storage object in a folder; org_id is half of the composite key to storage_objects, not an isolation key.',
  },
  { model: 'SecretType', kind: 'system', rationale: 'Shared secret-type definitions: system types are code-seeded, custom ones are shared.' },
  { model: 'Secret', kind: 'user', rationale: 'A secret belongs to the user who created it.' },
  { model: 'SecretVersion', kind: 'user', rationale: 'A version belongs to its secret, and so to the secret’s owner.' },
  { model: 'SecretAttachment', kind: 'user', rationale: 'An attachment belongs to its secret version, and so to the secret’s owner.' },
  { model: 'BackupSchedule', kind: 'system', rationale: 'The one system backup schedule, configured by administrators.' },
  { model: 'BackupRun', kind: 'user', rationale: 'A backup run is system-wide or belongs to the user it was made for.' },  { model: 'AgentCardGrant', kind: 'user', rationale: 'A merchant grant belongs to the card owner who created it (ADR-0003).' },
  { model: 'AgentCardGrantRequest', kind: 'user', rationale: 'A grant request belongs to the owner of the card it asks for.' },
  { model: 'AgentCardRelease', kind: 'user', rationale: 'A release belongs to its grant and card, and so to the card owner.' },
  { model: 'BrokerToken', kind: 'user', rationale: 'A broker token belongs to the user who created it (ADR-0006).' },
];
