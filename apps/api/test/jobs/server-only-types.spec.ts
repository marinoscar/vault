// =============================================================================
// Server-only job types (issue #81, E5.1)
// =============================================================================
//
// Node eligibility is DERIVED: a handler is eligible only when it carries BOTH
// `nodeResultSchema` and `persistNodeResult`. `JobHandlerRegistry.serverOnlyTypes()`
// is the complement, and `JOBS_WORKER_MODE=system` claims exactly that list.
//
// EVERY Vault-owned job type is server-only: the cleanups delete credential rows, the
// logical backup types hold the archive password and `VAULT_ENCRYPTION_KEY` (AGENTS.md:
// backup jobs are server-only). A type that is missing from `serverOnlyTypes()` is a type
// a worker node could be handed, so this boots the real module graph and asserts the
// registry the worker reads.
//
// THE ONE EXCEPTION IS THE PLATFORM'S, since E9.1 (#89): `db.backup.run` of the db-backup
// slice is node-eligible BY DESIGN. It carries no secret of Vault's: the node dumps the
// database (ciphertext only, `VAULT_ENCRYPTION_KEY` and `SECRETS_ENCRYPTION_KEY` never leave
// the API) through a per-job, SELECT-only, expiring PostgreSQL role the API mints and the
// node holds in memory only. A deployment declines offload with the `databaseBackup`
// system setting. `db.restore.run` stays server-only. This spec pins that the exception is
// exactly one type, so no other handler can become eligible by accident.
// =============================================================================

import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

describe('server-only job types (issue #81)', () => {
  let context: TestContext;
  let registry: JobHandlerRegistry;

  beforeAll(async () => {
    context = await createTestApp();
    registry = context.module.get(JobHandlerRegistry, { strict: false });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('registers at least the identity cleanups (the scan is not vacuous)', () => {
    expect(registry.types()).toEqual(expect.arrayContaining(['auth.token.cleanup', 'device-auth.code.cleanup']));
  });

  it('has exactly one node-eligible type, the platform\'s db.backup.run: serverOnlyTypes() is every other registered type', () => {
    const eligible = registry.types().filter((type) => !registry.serverOnlyTypes().includes(type));

    expect(eligible).toEqual(['db.backup.run']);
  });

  it('keeps every db-backup type but the dump server-only, the restore included', () => {
    expect(registry.serverOnlyTypes()).toEqual(
      expect.arrayContaining(['db.restore.run', 'db.backup.sweep', 'db.restore.old-db-drop']),
    );
  });
});
