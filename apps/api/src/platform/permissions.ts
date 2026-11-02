// The roles and permissions Vault seeds, as options for the platform's packaged
// registry (`@marinoscar/platform-api/manifest`): the permission sets of the
// slices Vault mounts (or enforces), in the platform's seed order, then Vault's
// own. The identity slice's four roles always come first. Pure data, no side
// effect: `prisma/seed.ts` composes the catalog from it
// (`platformPermissionCatalog`) and `app-registrations/registrations.ts` fills
// the registries with it, so the two never disagree.
//
// `storage` is listed although the storage routes are still Vault's legacy ones
// (E6 mounts the slice): the legacy controllers enforce `storage:read|write` and
// `storage:delete_any`, and the identity conformance suite fails a route whose
// permission nobody registered. E4.1 adds `settings`' own namespaces and E5.1
// adds `jobs`. `nodes` is listed because `NodeCredentialModule`
// (mounted for identity's `nod_` credential port) serves `/api/node-credentials`
// under `nodes:read|write`.
import type { PlatformPermissionOptions } from '@marinoscar/platform-api/manifest';

import { VAULT_PERMISSIONS } from '../app-registrations/permissions';

export const PERMISSION_OPTIONS = {
  slices: ['identity', 'settings', 'storage', 'nodes'],
  app: { permissions: [VAULT_PERMISSIONS] },
} satisfies PlatformPermissionOptions;
