// =============================================================================
// Real-Postgres test: `PrismaService.forOrg` / `runInOrg(orgId, ...)` work under
// row-level security for the application role (issue #75, E2.3)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(E3.1): the platform's slices will call
// `PLATFORM_PRISMA.forOrg(orgId, { userId })` / `runInOrg(orgId, fn)` on this
// service. This runs Vault's own `PrismaService` methods against a client
// connected as the ORDINARY application role, so FORCEd policies apply.
//
// A `*.db.spec.ts`: excluded from `npm test`, run by `npm run test:db`, skipped
// when no superuser Postgres is reachable. It creates and drops its own database.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../src/prisma/prisma.service';
import { runInOrg, ScopedAccessError } from '@marinoscar/platform-api/core';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();

if (!admin) {
  // eslint-disable-next-line no-console
  console.warn('\n[prisma-for-org.db.spec] SKIPPED: no superuser Postgres reachable to bootstrap the application role.\n');
}

const describeWithDb = admin ? describe : describe.skip;

describeWithDb('PrismaService.forOrg / runInOrg as the application role (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let service: PrismaService;
  const saved: Record<string, string | undefined> = {};

  let orgA: string;
  const orgB = randomUUID();
  const objectInput = (orgId: string) => ({
    orgId,
    name: `${randomUUID()}.pdf`,
    size: 1n,
    mimeType: 'application/pdf',
    storageKey: `rls/${randomUUID()}`,
  });

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    // PrismaService reads POSTGRES_* from the environment when constructed.
    for (const key of ['DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
      saved[key] = process.env[key];
      const value = (deployment.env as Record<string, string | undefined>)[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    service = new PrismaService();
    await service.onModuleInit();

    const bootstrap = deployment.adminClient();
    await bootstrap.connect();
    try {
      orgA = (await bootstrap.query(`SELECT id FROM organizations WHERE is_default`)).rows[0].id;
    } finally {
      await bootstrap.end();
    }
    await service.organization.create({
      data: { id: orgB, name: 'Org Beta', slug: `rls-beta-${orgB.slice(0, 8)}` },
    });
  }, 180_000);

  afterAll(async () => {
    await service?.onModuleDestroy().catch(() => undefined);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await deployment?.drop();
  });

  it('forOrg: a scoped client writes and reads its own organization only', async () => {
    await service.forOrg(orgA).storageObject.create({ data: objectInput(orgA) });
    await service.forOrg(orgB).storageObject.create({ data: objectInput(orgB) });

    expect(await service.forOrg(orgA).storageObject.count()).toBe(1);
    expect(await service.forOrg(orgB).storageObject.count()).toBe(1);
    // The plain pool sees nothing: the scope was transaction-local.
    expect(await service.storageObject.count()).toBe(0);
  });

  it('forOrg: refuses an insert naming another organization', async () => {
    await expect(service.forOrg(orgA).storageObject.create({ data: objectInput(orgB) })).rejects.toThrow();
  });

  it('forOrg: refuses a malformed organization id before any query', () => {
    expect(() => service.forOrg('not-a-uuid')).toThrow(ScopedAccessError);
  });

  it('forOrg: a scoped client derived from a transaction client is refused (it would escape the transaction)', async () => {
    await expect(
      service.forOrg(orgA).$transaction(async (tx) => tx.storageObject.count()),
    ).rejects.toThrow(ScopedAccessError);
  });

  it('runInOrg: one transaction, rolled back as a unit when the callback throws', async () => {
    const input = objectInput(orgA);
    await expect(
      service.runInOrg(orgA, async (tx) => {
        await tx.storageObject.create({ data: input });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await service.runInOrg(orgA, (tx) => tx.storageObject.count({ where: { storageKey: input.storageKey } }))).toBe(0);
  });

  it('runInOrg: a nested call for the same org reuses the transaction, another org is refused', async () => {
    const same = await service.runInOrg(orgA, async (tx) => runInOrg(tx as never, { orgId: orgA }, async () => 1));
    expect(same).toBe(1);
    await expect(
      service.runInOrg(orgA, async (tx) => runInOrg(tx as never, { orgId: orgB }, async () => 1)),
    ).rejects.toThrow(ScopedAccessError);
  });
});
