// =============================================================================
// Server-only job types (issue #81, E5.1)
// =============================================================================
//
// Node eligibility is DERIVED: a handler is eligible only when it carries BOTH
// `nodeResultSchema` and `persistNodeResult`. `JobHandlerRegistry.serverOnlyTypes()`
// is the complement, and `JOBS_WORKER_MODE=system` claims exactly that list.
//
// EVERY Vault job type is server-only, now and in E5.2: the cleanups delete
// credential rows, the backup types hold the archive password and
// `VAULT_ENCRYPTION_KEY` (AGENTS.md: backup jobs are server-only). A type that
// is missing from `serverOnlyTypes()` is a type a worker node could be handed,
// so this boots the real module graph and asserts the registry the worker reads.
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

  it('has no node-eligible type: serverOnlyTypes() is every registered type', () => {
    expect([...registry.serverOnlyTypes()].sort()).toEqual([...registry.types()].sort());
  });
});
