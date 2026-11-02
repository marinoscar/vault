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
// permission nobody registered. `jobs` and `nodes` (E5.1) are the queue's admin routes
// (`/api/admin/jobs/*`, `jobs:read|write`) and the worker-node fleet
// (`/api/nodes/*`, `/api/admin/nodes/*`, `/api/node-credentials`). `notifications` (E7.1)
// declares `broadcasts:*` and `push:*` (system, admin) and `org_broadcasts:*` (org, org_admin).
// `telemetry` (E9.2) declares `telemetry:read|write|query` (system, admin). `ai` is listed for
// `ai:use`, which the telemetry assistant route requires next to `telemetry:query`; the AI slice
// itself (E8) mounts its own routes.
// `db-backup` (E9.1) declares `db_backup:read|write|restore` (system, admin only). `user-data` (E9.3)
// declares `system:factory_reset` and `orgs:offboard` (system, admin only).
import type { PlatformPermissionOptions } from '@marinoscar/platform-api/manifest';

import { VAULT_PERMISSIONS } from '@marinoscar/vault-api/core';

export const PERMISSION_OPTIONS = {
  slices: ['identity', 'settings', 'storage', 'jobs', 'nodes', 'ai', 'notifications', 'telemetry', 'db-backup', 'user-data'],
  app: { permissions: [VAULT_PERMISSIONS] },
} satisfies PlatformPermissionOptions;
