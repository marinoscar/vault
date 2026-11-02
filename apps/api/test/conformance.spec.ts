// The platform's invariants, run against THIS app (`runPlatformConformance`).
// The package owns each scan; the app supplies only its own data.
//
// Only the suites of the slices Vault has ADOPTED run. Each suite of a slice that
// is not adopted yet is listed below with the written reason and the epic
// child that removes the skip (platform-adoption epic #54: E3.1 = #76 host,
// E3.2 = #77 identity, E4.1 = #79 settings, E5.1 = #81 jobs and nodes,
// E5.3 = #83 queue rule, E6.1 = #84 storage, E7.1 = #85 email and notifications).
import '../src/app-registrations/registrations';
import '@marinoscar/platform-api/ai/testing';
import '../src/platform/storage/storage-key-prefix.manifest';
import '@marinoscar/platform-api/db-backup/testing';
import '@marinoscar/platform-api/email/testing';
import '@marinoscar/platform-api/exports/testing';
import '@marinoscar/platform-api/host/testing';
import '@marinoscar/platform-api/identity/testing';
import '@marinoscar/platform-api/jobs/testing';
import '@marinoscar/platform-api/notifications/testing';
import '@marinoscar/platform-api/onboarding/testing';
import '@marinoscar/platform-api/settings/testing';
import '@marinoscar/platform-api/telemetry/testing';
import '@marinoscar/platform-api/storage/testing';
import '@marinoscar/platform-api/user-data/testing';

import { Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { composedSchemaDatamodel } from '@marinoscar/platform-api/user-data';

import { AppModule } from '../src/app.module';
import { CRON_EXEMPTIONS, VAULT_API_SOURCE_ROOT, VAULT_SOURCE_ROOTS } from './jobs/cron-source-roots';

const API_DIR = join(__dirname, '..');
const REPO_DIR = join(API_DIR, '..', '..');

/**
 * The root the identity suite walks: every controller reachable from `AppModule`
 * (the slice's own and all of Vault's), so no route can be public by accident.
 */
@Module({ controllers: discoverControllers(AppModule) })
class IdentityConformanceRoot {}

runPlatformConformance({
  sourceRoots: [...VAULT_SOURCE_ROOTS],
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
    // `maintenance`, `jobs`, `retention`, `nodes` (E5.1) plus Vault's `ui`, `features`, `ai` (the platform's, E8.1),
    // `vaultCards`, `vaultBackups`, plus `storage` (E6.1), `notifications` (E7.1) and `databaseBackup` (E9.1).
    settings: {
      permissions: permissionRegistry.list(),
      minSystemNamespaces: 13,
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
        {
          file: 'platform/onboarding/onboarding-data.adapter.ts',
          why: 'queryAggregate(): the activation metrics\' one developer-authored aggregate statement, run with positional values inside a SET TRANSACTION READ ONLY transaction; it takes no request-derived id.',
        },
      ],
    },

    // The email slice (E7.1, #85): the platform templates are registered, every sampled template
    // renders a complete document and escapes markup in its data, and no email settings shape carries
    // a secret. Vault's three templates (E7.2, #86) are sampled with markup in every text field.
    email: {
      samples: {
        'vault-backup-succeeded': {
          runId: 'run-1',
          scope: 'system',
          trigger: 'schedule',
          startedAt: '2027-01-02T03:00:00.000Z',
          finishedAt: '2027-01-02T03:04:00.000Z',
          sizeBytes: 2048,
          secretCount: 3,
          attachmentCount: 0,
          mediaFileCount: 0,
          warningCount: 0,
        },
        'vault-backup-failed': {
          runId: 'run-1',
          scope: 'user',
          trigger: 'manual',
          startedAt: '2027-01-02T03:00:00.000Z',
          finishedAt: '2027-01-02T03:04:00.000Z',
          sizeBytes: null,
          secretCount: 0,
          attachmentCount: 0,
          mediaFileCount: 0,
          warningCount: 0,
          error: '<script>alert(1)</script>',
        },
        'vault-card-expiring': {
          secretId: '8d1c1f0e-1111-4222-8333-444455556666',
          secretName: '<script>alert(1)</script>',
          expiry: '07/2027',
          threshold: 7,
        },
      },
    },

    // The notifications slice (E7.1, #85): the platform channels and events are registered, every
    // event that declares `email` has a template, no `notify*` call sits inside a `$transaction`
    // callback, and the Web Push shapes carry no secret. The after-commit allowlist is EMPTY on
    // purpose: Vault has no argued exception.
    notifications: { afterCommitAllowlist: [] },

    // The telemetry slice (E9.2, #90): the platform's metric groups and Vault's own (`vault`) are well
    // formed and compute against an empty schema, every `/api/admin/telemetry/*` and
    // `/api/telemetry/*` route carries exactly the permissions its shape needs, the Doctor checks are
    // read-only, no response carries a stored GreptimeDB password, and the module boots with telemetry
    // off. The slice's retention cron ships in the package, outside Vault's source root.
    telemetry: {},

    // The `@Cron` half of queue rule 1 (E5.1/E5.3, #81/#83): every `@Cron` body in Vault's own
    // sources only enqueues a job. The platform's crons (the three permanent exemptions, the
    // identity cleanups, the storage stale-upload sweep) ship in the package and are held by its
    // tests. Vault has NO exemption since E6.1. `minCronFiles` is the backup schedule task: the
    // scan must keep finding it, so the scan cannot pass vacuously.
    cronEnqueueOnly: { exempt: [...CRON_EXEMPTIONS], minCronFiles: CRON_EXEMPTIONS.length + 1 },

    // The AI slice's two source scans (E8.1, #87); the five that boot the app run in
    // `ai-conformance.spec.ts`. No provider SDK is imported anywhere Vault ships: the API, the
    // web and the CLI reach a model through the platform AI slice only, whose adapters (with their
    // SDKs) live in the package, outside these trees. `minFiles` stops a mistyped root from passing
    // on an empty tree.
    aiNoSdkLeak: {
      apiTrees: [
        { name: 'apps/api/src', root: join(API_DIR, 'src'), minFiles: 100 },
        { name: 'packages/vault-api/src', root: VAULT_API_SOURCE_ROOT, minFiles: 60 },
      ],
      // Since E12.3 (#104) the web host keeps only routes, providers and adapters; the domain
      // pages live in @marinoscar/vault-web, scanned as its own tree.
      webTrees: [
        { name: 'apps/web/src', root: join(REPO_DIR, 'apps', 'web', 'src'), minFiles: 25 },
        { name: 'packages/vault-web/src', root: join(REPO_DIR, 'packages', 'vault-web', 'src'), minFiles: 80 },
      ],
      noSdkManifests: [
        join(REPO_DIR, 'package.json'),
        join(API_DIR, 'package.json'),
        join(REPO_DIR, 'apps', 'web', 'package.json'),
        join(REPO_DIR, 'apps', 'cli', 'package.json'),
        join(REPO_DIR, 'packages', 'vault-api', 'package.json'),
        join(REPO_DIR, 'packages', 'vault-web', 'package.json'),
      ],
    },
    // No agent-orchestration framework anywhere; `allowedRoots` is EMPTY on purpose.
    aiOrchestrationBoundary: {
      apiSourceRoots: [join(API_DIR, 'src'), VAULT_API_SOURCE_ROOT],
      webSourceRoots: [join(REPO_DIR, 'apps', 'web', 'src'), join(REPO_DIR, 'packages', 'vault-web', 'src')],
      packageJsonPaths: [
        join(REPO_DIR, 'package.json'),
        join(API_DIR, 'package.json'),
        join(REPO_DIR, 'apps', 'web', 'package.json'),
        join(REPO_DIR, 'apps', 'cli', 'package.json'),
        join(REPO_DIR, 'packages', 'vault-api', 'package.json'),
        join(REPO_DIR, 'packages', 'vault-web', 'package.json'),
      ],
      allowedRoots: {},
    },

    // The `@OnEvent` half (`on-event-no-io`) cannot run as a platform suite here: it requires at
    // least one listener (a vacuity guard) and, since E6.1 (#84), Vault has none. The same detector
    // runs without an exemption in test/jobs/on-event-no-io.spec.ts.
    onEventNoIo: {
      skip: 'Vault has no @OnEvent listener since E6.1 and the suite needs at least one (vacuity guard); test/jobs/on-event-no-io.spec.ts applies the same detector with no exemption.',
    },

    // The key-prefix registry (every prefix well formed and disjoint, org prefixes build
    // `<prefix><orgId>/...`, no secret-named field in the storage namespace) and that Vault's
    // backup prefixes are registered, so the purge reaches them (E6.1, #84).
    storage: { requiredPrefixIds: ['system-backups', 'user-backups', 'database-backups'] },

    // The db-backup slice (E9.1, #89): both halves of the RLS pair on every `pg_dump` and
    // `pg_restore` (flag in argv, option in the ENVIRONMENT, never argv), `db.restore.run` server-only
    // and `db.backup.run` node-eligible with its profile and broker, every `db_backup:*` permission
    // system scope, the `database-backups/` prefix registered with deployment scope, and every
    // registered carry binding `$1`. Vault registers NO carry-over (app-registrations/db-backup.ts
    // says why), so none is required.
    dbBackup: { requiredCarryOverIds: [] },

    // The exports slice (E9.3, #91): every source names a registered permission and offers a registered
    // writer, the user-owned registry agrees with the datamodel, and the `secret-egress` case fills every
    // model with sentinels and runs `user-data` and `org-data` through every writer: no ciphertext, secret
    // or hash column reaches any output. Vault's `vault-secrets` source is held by its own spec and by
    // `test/export/platform-export-secrets.db.spec.ts` (decrypted-value and ciphertext markers).
    exports: { datamodel: Prisma.dmmf.datamodel, permissions: permissionRegistry.list() },

    // The user-data slice (E9.3, #91): every owner model has an explicit decision that `everything`
    // reaches (secrets, media folders, backup runs, custom types), every hint and scope names a model,
    // column and category that exist, and a delete order exists for this schema.
    userData: { datamodel: composedSchemaDatamodel(__dirname)() },

    // The onboarding slice (E9.3, #91): every fact a step names is registered, no required step is
    // skippable, every step permission is exactly a registered permission, each fact resolves at most
    // once per request and no data-port call happens while steps evaluate. `factSamples` stands in for
    // the facts that would query.
    onboarding: {
      permissions: permissionRegistry.list(),
      factSamples: {
        'vault.ownSecretCount': 0,
        'vault.cardScan': { available: true, count: 0 },
        'vault.ownBackupCount': 0,
        'vault.ownTokenCount': 0,
        'vault.backupSchedule': { enabled: false, passwordConfigured: false },
      },
      minSteps: 12,
    },
  },
});
