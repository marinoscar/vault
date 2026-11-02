// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data.
//
// Only the suites of the slices Vault has ADOPTED run. Each suite of a slice that
// is not adopted yet is listed below with the written reason and the epic
// child that removes the skip (platform-adoption epic #54, E3.1 = #76).
import '@marinoscar/platform-api/host/testing';

import { join } from 'node:path';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../src/app.module';

const SOURCE_ROOT = join(__dirname, '..', 'src');

runPlatformConformance({
  sourceRoots: [SOURCE_ROOT],
  suites: {
    // MaintenanceGuard is the first (and only) APP_GUARD; no global JWT guard;
    // PlatformHostCoreModule is mounted once. Vault adds no global guard.
    host: { rootModule: AppModule, allowedAppGuards: [] },

    // KNOWN EXCEPTION until E5.1/E5.2 (#80/#81): `backups/backup-runner.service.ts`
    // runs backups in-process from a `@Cron` (docs/platform-adoption/local-exceptions.md),
    // and `storage/` and `auth/` keep their own crons until their slices land.
    cronEnqueueOnly: {
      skip: 'Vault still runs the backup runner, storage cleanup and auth sweeps inline from @Cron; they become queue jobs in E5 (see docs/platform-adoption/local-exceptions.md).',
    },

    // The platform user-owned-model registry and the composed schema's ownership
    // inventory arrive with the identity slice (E3.2 / #77); Vault keeps its own
    // user-delete logic until then.
    userOwnedData: {
      skip: 'The user-owned-data registry arrives with the identity slice (E3.2); until then Vault deletes users with its own cascade rules.',
    },
  },
});
