// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data.
//
// Only the suites of the slices Vault has ADOPTED run. Each suite of a slice that
// is not adopted yet is listed below with the written reason and the epic
// child that removes the skip (platform-adoption epic #54: E3.1 = #76 host,
// E3.2 = #77 identity, E4.1 = #79 settings, E5.1 = #81 jobs and nodes,
// E5.3 = #83 queue rule, E6.1 = #84 storage).
import '../src/app-registrations/registrations';
import '../src/platform/storage/storage-key-prefix.manifest';
import '@marinoscar/platform-api/host/testing';
import '@marinoscar/platform-api/identity/testing';
import '@marinoscar/platform-api/jobs/testing';
import '@marinoscar/platform-api/settings/testing';
import '@marinoscar/platform-api/storage/testing';

import { Module } from '@nestjs/common';
import { join } from 'node:path';
import {
  buildPermissionCatalog,
  catalogGrants,
  permissionRegistry,
  roleRegistry,
  userOwnedModelRegistry,
} from '@marinoscar/platform-api/core';
import { discoverControllers } from '@marinoscar/platform-api/identity/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../src/app.module';
import { API_SOURCE_ROOT, CRON_EXEMPTIONS } from './jobs/cron-source-roots';

const API_DIR = join(__dirname, '..');

/**
 * The root the identity suite walks: every controller reachable from `AppModule`
 * (the slice's own and all of Vault's), so no route can be public by accident.
 */
@Module({ controllers: discoverControllers(AppModule) })
class IdentityConformanceRoot {}

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    // MaintenanceGuard is the first (and only) APP_GUARD; no global JWT guard;
    // PlatformHostCoreModule is mounted once. Vault adds no global guard.
    host: { rootModule: AppModule, allowedAppGuards: [] },

    // Every controller handler declares `@Auth(...)` or `@Public()`, every permission
    // a route names is registered with a scope, no seeded grant crosses a scope, and
    // `nod_` / `pat_` tokens stay confined (E3.2, #77).
    identity: {
      rootModule: IdentityConformanceRoot,
      permissions: permissionRegistry.list(),
      roles: roleRegistry.list(),
      grants: catalogGrants(buildPermissionCatalog()),
    },

    // No secret-named field in any registered system or user namespace (the AI key
    // is a credential, E4.2), every default valid against its stored schema, and
    // every org layer gated by a registered org-scope permission (E4.1, #79).
    // `maintenance`, `jobs`, `retention`, `nodes` (E5.1) plus Vault's `ui`, `features`, `ai`,
    // `vaultCards`, `vaultBackups`, and `storage` (E6.1).
    settings: {
      permissions: permissionRegistry.list(),
      minSystemNamespaces: 10,
    },

    // Every foreign key to `User` in the composed schema is registered with a purge
    // and export policy that matches its `onDelete` (src/app-registrations/user-owned-models.ts).
    // The raw SQL below cannot be expressed by the Prisma client; none takes a
    // request-derived id unscoped.
    userOwnedData: {
      schemaPath: join(API_DIR, 'prisma', 'schema'),
      policies: userOwnedModelRegistry.list(),
      registerIn: 'src/app-registrations/user-owned-models.ts',
      rawSqlAllowlist: [
        {
          file: 'prisma/prisma.service.ts',
          why: 'cleanDatabase(): TRUNCATE of every table, refused unless NODE_ENV is test.',
        },
        {
          file: 'secrets/secrets.service.ts',
          why: 'SELECT ... FOR UPDATE on one storage object id the caller already proved it may attach.',
        },
      ],
    },

    // The `@Cron` half of queue rule 1 (E5.1/E5.3, #81/#83): every `@Cron` body in Vault's own
    // sources only enqueues a job. The platform's crons (the three permanent exemptions, the
    // identity cleanups, the storage stale-upload sweep) ship in the package and are held by its
    // tests. Vault has NO exemption since E6.1. `minCronFiles` is the backup schedule task: the
    // scan must keep finding it, so the scan cannot pass vacuously.
    cronEnqueueOnly: { exempt: [...CRON_EXEMPTIONS], minCronFiles: CRON_EXEMPTIONS.length + 1 },

    // The `@OnEvent` half (`on-event-no-io`) cannot run as a platform suite here: it requires at
    // least one listener (a vacuity guard) and, since E6.1 (#84), Vault has none. The same detector
    // runs without an exemption in test/jobs/on-event-no-io.spec.ts.
    onEventNoIo: {
      skip: 'Vault has no @OnEvent listener since E6.1 and the suite needs at least one (vacuity guard); test/jobs/on-event-no-io.spec.ts applies the same detector with no exemption.',
    },

    // The key-prefix registry (every prefix well formed and disjoint, org prefixes build
    // `<prefix><orgId>/...`, no secret-named field in the storage namespace) and that Vault's
    // backup prefixes are registered, so the purge reaches them (E6.1, #84).
    storage: { requiredPrefixIds: ['system-backups', 'user-backups'] },
  },
});
