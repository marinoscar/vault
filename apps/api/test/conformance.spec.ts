// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data.
//
// Only the suites of the slices Vault has ADOPTED run. Each suite of a slice that
// is not adopted yet is listed below with the written reason and the epic
// child that removes the skip (platform-adoption epic #54: E3.1 = #76 host,
// E3.2 = #77 identity, E4.1 = #79 settings).
import '../src/app-registrations/registrations';
import '@marinoscar/platform-api/host/testing';
import '@marinoscar/platform-api/identity/testing';
import '@marinoscar/platform-api/settings/testing';

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

const SOURCE_ROOT = join(__dirname, '..', 'src');
const API_DIR = join(__dirname, '..');

/**
 * The root the identity suite walks: every controller reachable from `AppModule`
 * (the slice's own and all of Vault's), so no route can be public by accident.
 */
@Module({ controllers: discoverControllers(AppModule) })
class IdentityConformanceRoot {}

runPlatformConformance({
  sourceRoots: [SOURCE_ROOT],
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
    // `maintenance` plus Vault's `ui`, `features`, `ai`, `vaultCards`, `vaultBackups`.
    settings: {
      permissions: permissionRegistry.list(),
      minSystemNamespaces: 6,
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
          file: 'backups/backup-runner.service.ts',
          why: 'pg_advisory_xact_lock for the one-active-run and per-user serialisation; takes constants and a hashed owner id.',
        },
        {
          file: 'secrets/secrets.service.ts',
          why: 'SELECT ... FOR UPDATE on one storage object id the caller already proved it may attach.',
        },
      ],
    },

    // KNOWN EXCEPTION until E5.1/E5.2 (#81/#82): `backups/backup-runner.service.ts`
    // runs backups in-process from a `@Cron` (docs/platform-adoption/local-exceptions.md),
    // and `storage/` keeps its own cleanup cron until the storage slice lands.
    cronEnqueueOnly: {
      skip: 'Vault still runs the backup runner and storage cleanup inline from @Cron; they become queue jobs in E5 (see docs/platform-adoption/local-exceptions.md).',
    },
  },
});
