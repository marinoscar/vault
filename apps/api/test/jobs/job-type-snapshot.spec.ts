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
  // backups (E5.2): the logical secret backups, both server-only
  'vault.backup.run',
  'vault.user_backup.run',
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
