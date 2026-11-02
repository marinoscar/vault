// =============================================================================
// Vault's model ownership classification (issue #77, E3.2)
// =============================================================================
//
// Every Vault model is classified (`user`, `org`, `org-optional` or `system`);
// the `user-owned-data` conformance suite fails on any model it cannot find
// here. Vault content belongs to a USER, not to an organization: the org-isolated
// models are the platform's (`StorageObject` and its chunks, ...).
// `MediaFolderFile` carries an `org_id` only as the second half of the
// composite key to its storage object (no row-level security of its own, see
// docs/platform-adoption/local-exceptions.md), so it names it as a reference.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';

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
  { model: 'BackupRun', kind: 'user', rationale: 'A backup run is system-wide or belongs to the user it was made for.' },
];
