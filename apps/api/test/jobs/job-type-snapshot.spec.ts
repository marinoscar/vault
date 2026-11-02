// =============================================================================
// Job-type snapshot (issue #81, E5.1, epic #54)
// =============================================================================
//
// A `jobs` row names its handler by the `type` STRING. Rows outlive code: a
// `pending` row written before a deploy is claimed by whatever the new code
// registers. If a type string changes, or a handler stops registering, every
// queued row of that type is stranded as an "unknown job type" permanent
// failure. This spec pins every string Vault registers, so no later change can
// silently drop or rename one.
//
// The strings below are LITERALS on purpose: resolving them from the handlers'
// own constants would make the test follow a rename instead of catching it.
// NEVER edit a string in this list. Add new types as their epic lands.
//
// The check is a SUPERSET check: the app may register more than is pinned (a new
// type is added here deliberately, in the PR that adds it), but never fewer.
// =============================================================================

import { JobHandlerRegistry, jobTypeLabels } from '@marinoscar/platform-api/jobs';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

/** Every type the platform registers in Vault's composition, by owner. */
const PINNED_JOB_TYPES = [
  // jobs slice (`JobsModule.forRoot`): queue and retention housekeeping
  'job.history.purge',
  'audit.events.purge',
  // identity slice, through `IDENTITY_JOBS` (E5.1 replaced the no-op shim)
  'auth.token.cleanup',
  'device-auth.code.cleanup',
  // nodes slice (`NodesModule.forRoot`): fleet housekeeping
  'nodes.fleet.sweep',
  'nodes.fleet.prune',
  'nodes.node_events_purge',
  // storage slice (`StorageModule.forRoot`, E6.1): the stale-upload sweep and the post-upload processors,
  // both server-only (they hold no node result schema)
  'storage.cleanup.stale-uploads',
  'storage.object.process',
  // notifications slice (`NotificationsModule.forRoot`, E7.1): retention of the inbox and delivery rows
  'notifications.inbox.purge',
  'notifications.deliveries.purge',
  // admin broadcasts (`BroadcastsModule`, E7.1): the fan-out of one broadcast, in chunks
  'admin.broadcast.start',
  'admin.broadcast.chunk',
  // backups (E5.2): the logical secret backups, both server-only
  'vault.backup.run',
  'vault.user_backup.run',
  // card expiry reminders (E7.2): the daily scan, server-only
  'vault.cards.expiry_scan',
  // telemetry slice (`TelemetryModule.forRoot`, E9.2): store retention (TTL) and the stack deploy; both server-only
  'telemetry.retention.apply',
  'telemetry.stack.deploy',
  // db-backup slice (`DbBackupModule.forRoot`, E9.1): whole-database backup and restore.
  // `db.backup.run` is the platform's one node-eligible type; `db.restore.run` is server-only forever
  'db.backup.run',
  'db.backup.sweep',
  'db.restore.run',
  'db.restore.old-db-drop',
  // exports slice (`ExportsModule.forRoot`, E9.3): the file build and the expiry sweep, both server-only
  'export.run',
  'export.purge',
  // user-data slice (`UserDataModule.forRoot`, E9.3): the per-user purge, the admin factory reset and the
  // organization offboarding, all server-only; plus Vault's delegate for backup runs and custom secret types
  'user.data.purge',
  'admin.factory_reset',
  'org.offboard',
  'vault.user_data.purge',
] as const;

describe('job type snapshot (issue #81)', () => {
  let context: TestContext;
  let registry: JobHandlerRegistry;

  beforeAll(async () => {
    context = await createTestApp();
    registry = context.module.get(JobHandlerRegistry, { strict: false });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('commits a list with no duplicates', () => {
    expect(new Set(PINNED_JOB_TYPES).size).toBe(PINNED_JOB_TYPES.length);
  });

  it('registers every pinned type string (superset)', () => {
    const missing = PINNED_JOB_TYPES.filter((type) => !registry.types().includes(type));

    expect(missing).toEqual([]);
  });

  it('gives every registered type a non-empty label for the admin Jobs list', () => {
    const labels = Object.fromEntries(jobTypeLabels());
    const unlabelled = registry.types().filter((type) => !(labels[type] ?? '').trim());

    expect(unlabelled).toEqual([]);
  });
});
