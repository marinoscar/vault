// =============================================================================
// Real-Postgres test: tenant isolation holds for the application role
// (issue #75, E2.3)
// =============================================================================
//
// The API connects as an ORDINARY role (`NOSUPERUSER NOBYPASSRLS`) that owns
// every table. A superuser or a BYPASSRLS role skips every policy, FORCE
// included, so this suite builds a deployment the way a fresh volume does
// (`test/helpers/app-role-database.helper.ts`: role, extension, migrate with no
// superuser) and then talks to it AS THAT ROLE:
//
//   - the role is neither superuser nor BYPASSRLS, and owns every table;
//   - the org tables FORCE row-level security;
//   - with `app.org_id` unset, `storage_objects` and `storage_object_chunks`
//     show nothing and refuse an insert;
//   - inside `runInOrg`, an org sees exactly its own rows and cannot write
//     another org's;
//   - Vault's own domain code paths (the attachment reads, the FOR UPDATE unlink
//     transaction) work through `runInDefaultOrg`. The storage slice's own
//     ObjectsService is the platform's and is exercised end to end, as this role,
//     by test/storage/storage-adoption.db.spec.ts.
//
// Like every `*.db.spec.ts` it is excluded from `npm test` and runs through
// `npm run test:db`; it skips when no Postgres, or no superuser to bootstrap
// the role with, is reachable. It creates and drops its own database and role.
// =============================================================================

import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { PrismaClient } from '@prisma/client';

import { defaultOrgClient, getDefaultOrgId, runInDefaultOrg } from '@marinoscar/vault-api/core';
import { runInOrg } from '@marinoscar/platform-api/core';
import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();

if (!admin) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[storage-isolation.db.spec] SKIPPED: no superuser reachable at ` +
      `${process.env.POSTGRES_HOST ?? '(POSTGRES_HOST unset)'}:${process.env.POSTGRES_PORT ?? '5432'} to bootstrap the ` +
      `application role with. Start a Postgres (infra/compose/test.compose.yml) and re-run \`npm run test:db\`.\n`,
  );
}

const describeWithDb = admin ? describe : describe.skip;

/** The tables that FORCE row-level security: the platform's (migration 0025) and Vault's media_folder_files (E6.2). */
const FORCED_TABLES = ['storage_objects', 'storage_object_chunks', 'ai_runs', 'ai_usage_events', 'media_folder_files'];

describeWithDb('tenant isolation as the application role (real Postgres)', () => {
  let deployment: AppRoleDatabase;
  let app: Client;
  let prisma: PrismaClient;

  let defaultOrg: string;
  const otherOrg = randomUUID();
  const defaultObjects = [randomUUID(), randomUUID(), randomUUID()];
  const otherObjects = [randomUUID(), randomUUID()];

  /** One statement batch as the role, with the org scope set transaction-locally. */
  async function asOrg<R>(orgId: string | null, fn: (client: Client) => Promise<R>): Promise<R> {
    await app.query('BEGIN');
    try {
      if (orgId) await app.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const result = await fn(app);
      await app.query('COMMIT');
      return result;
    } catch (error) {
      await app.query('ROLLBACK');
      throw error;
    }
  }

  async function insertObject(client: Client, id: string, orgId: string): Promise<void> {
    await client.query(
      `INSERT INTO storage_objects (id, name, size, mime_type, storage_key, updated_at, org_id)
       VALUES ($1, $2, 1024, 'application/pdf', $3, now(), $4)`,
      [id, `${id}.pdf`, `rls/${id}`, orgId],
    );
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);

    app = deployment.appClient();
    await app.connect();
    prisma = deployment.prismaClient();

    // The migrations create the default organization; add a second one. Both
    // organizations' rows are written AS THE ROLE, through its scope.
    const bootstrap = deployment.adminClient();
    await bootstrap.connect();
    try {
      defaultOrg = (await bootstrap.query(`SELECT id FROM organizations WHERE is_default`)).rows[0].id;
    } finally {
      await bootstrap.end();
    }
    await app.query(
      `INSERT INTO organizations (id, name, slug, is_default, updated_at) VALUES ($1, 'Other', $2, false, now())`,
      [otherOrg, `rls-other-${otherOrg.slice(0, 8)}`],
    );

    await asOrg(defaultOrg, async (client) => {
      for (const id of defaultObjects) await insertObject(client, id, defaultOrg);
    });
    await asOrg(otherOrg, async (client) => {
      for (const id of otherObjects) await insertObject(client, id, otherOrg);
    });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await app?.end().catch(() => undefined);
    await deployment?.drop();
  });

  describe('the role', () => {
    it('is neither a superuser nor BYPASSRLS', async () => {
      const { rows } = await app.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: true, rolcreaterole: true });
    });

    it('owns the database, schema public and every table the migrations created', async () => {
      const db = await app.query(
        `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`,
      );
      expect(db.rows[0].owner).toBe(deployment.role);

      const schema = await app.query(`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`);
      expect(schema.rows[0].owner).toBe(deployment.role);

      const strangers = await app.query(
        `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> $1`,
        [deployment.role],
      );
      expect(strangers.rows).toEqual([]);
    });
  });

  describe('the policies', () => {
    it('FORCE row-level security on the org tables, so they apply to the owner', async () => {
      const { rows } = await app.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relname = ANY($1) AND relkind = 'r' ORDER BY relname`,
        [FORCED_TABLES],
      );
      expect(rows.map((row) => row.relname)).toEqual([...FORCED_TABLES].sort());
      for (const row of rows) {
        expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      }
    });
  });

  describe('storage_objects with no organization scope', () => {
    it('shows no rows when app.org_id is unset', async () => {
      const { rows } = await app.query(`SELECT count(*)::int AS n FROM storage_objects`);
      expect(rows[0].n).toBe(0);
    });

    it('shows no rows when app.org_id is empty', async () => {
      const n = await asOrg(null, async (client) => {
        await client.query(`SELECT set_config('app.org_id', '', true)`);
        return (await client.query(`SELECT count(*)::int AS n FROM storage_objects`)).rows[0].n;
      });
      expect(n).toBe(0);
    });

    it('shows no rows to an unscoped Prisma client', async () => {
      expect(await prisma.storageObject.count()).toBe(0);
      expect(await prisma.storageObjectChunk.count()).toBe(0);
    });

    it('refuses an unscoped insert (WITH CHECK)', async () => {
      await expect(
        prisma.storageObject.create({
          data: { orgId: defaultOrg, name: 'x.pdf', size: 1n, mimeType: 'application/pdf', storageKey: 'rls/unscoped' },
        }),
      ).rejects.toThrow();
    });

    it('proves the rows exist: the bootstrap superuser sees every one of them', async () => {
      const bootstrap = deployment.adminClient();
      await bootstrap.connect();
      try {
        const { rows } = await bootstrap.query(`SELECT count(*)::int AS n FROM storage_objects`);
        expect(rows[0].n).toBe(defaultObjects.length + otherObjects.length);
      } finally {
        await bootstrap.end();
      }
    });
  });

  describe('storage_objects inside runInOrg', () => {
    it('returns the real count for the default organization', async () => {
      const n = await runInOrg(prisma, { orgId: defaultOrg }, (tx) => tx.storageObject.count());
      expect(n).toBe(defaultObjects.length);
    });

    it('returns only the other organization its own rows', async () => {
      const ids = await runInOrg(prisma, { orgId: otherOrg }, async (tx) =>
        (await tx.storageObject.findMany({ select: { id: true } })).map((row) => row.id).sort(),
      );
      expect(ids).toEqual([...otherObjects].sort());
    });

    it('does not leak the scope into the next, unscoped statement on the pool', async () => {
      await runInOrg(prisma, { orgId: defaultOrg }, (tx) => tx.storageObject.count());
      expect(await prisma.storageObject.count()).toBe(0);
    });

    it('refuses a write that names another organization (WITH CHECK)', async () => {
      await expect(
        asOrg(defaultOrg, (client) => insertObject(client, randomUUID(), otherOrg)),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('writes a chunk with its object in one scoped transaction, and rolls back on a throw', async () => {
      const objectId = randomUUID();
      await expect(
        runInOrg(prisma, { orgId: defaultOrg }, async (tx) => {
          await tx.storageObject.create({
            data: { id: objectId, orgId: defaultOrg, name: 'c.pdf', size: 1n, mimeType: 'application/pdf', storageKey: `rls/${objectId}` },
          });
          await tx.storageObjectChunk.create({ data: { objectId, orgId: defaultOrg, partNumber: 1, eTag: 'e', size: 1n } });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await runInOrg(prisma, { orgId: defaultOrg }, (tx) => tx.storageObject.count({ where: { id: objectId } }))).toBe(0);
    });
  });

  describe('media_folder_files (E6.2: forced org_id policy)', () => {
    let folderId: string;
    const userId = randomUUID();

    beforeAll(async () => {
      // users and media_folders are not org tables: written without a scope.
      await app.query(`INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now())`, [userId, `mf-${userId}@example.test`]);
      folderId = randomUUID();
      await app.query(`INSERT INTO media_folders (id, name, user_id, updated_at) VALUES ($1, 'Folder', $2, now())`, [folderId, userId]);
      await asOrg(defaultOrg, (c) =>
        c.query(`INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ($1, $2, $3)`, [defaultObjects[1], defaultOrg, folderId]),
      );
      await asOrg(otherOrg, (c) =>
        c.query(`INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ($1, $2, $3)`, [otherObjects[1], otherOrg, folderId]),
      );
    });

    it('shows no rows without an organization scope', async () => {
      expect((await app.query(`SELECT count(*)::int AS n FROM media_folder_files`)).rows[0].n).toBe(0);
    });

    it("hides another organization's rows", async () => {
      const mine = await asOrg(defaultOrg, async (c) => (await c.query(`SELECT object_id FROM media_folder_files`)).rows);
      expect(mine.map((r) => r.object_id)).toEqual([defaultObjects[1]]);
      const theirs = await asOrg(otherOrg, async (c) => (await c.query(`SELECT object_id FROM media_folder_files`)).rows);
      expect(theirs.map((r) => r.object_id)).toEqual([otherObjects[1]]);
    });

    it('refuses an insert for another organization (policy WITH CHECK)', async () => {
      await expect(
        asOrg(defaultOrg, (c) =>
          c.query(`INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ($1, $2, $3)`, [otherObjects[0], otherOrg, folderId]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('refuses an insert without an organization scope', async () => {
      await expect(
        app.query(`INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ($1, $2, $3)`, [defaultObjects[2], defaultOrg, folderId]),
      ).rejects.toThrow(/row-level security/);
    });

    it("refuses a link to another organization's object even in its own scope (composite foreign key)", async () => {
      await expect(
        asOrg(defaultOrg, (c) =>
          c.query(`INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ($1, $2, $3)`, [otherObjects[0], defaultOrg, folderId]),
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe('secret_attachments composite foreign key (E6.2)', () => {
    async function seedVersion() {
      const user = await prisma.user.create({ data: { email: `fk-${randomUUID()}@example.test` } });
      const type = await prisma.secretType.create({ data: { name: `fk-type-${randomUUID()}`, fields: [], allowAttachments: true } });
      const secret = await prisma.secret.create({ data: { name: 'fk secret', typeId: type.id, createdById: user.id } });
      const version = await prisma.secretVersion.create({
        data: { secretId: secret.id, version: 1, encryptedData: 'x', iv: 'y', authTag: 'z', isCurrent: true },
      });
      return { secretId: secret.id, secretVersionId: version.id };
    }

    it("refuses an attachment of one organization pointing at another organization's object", async () => {
      const base = await seedVersion();
      // The object exists, but in the other organization: (storage_object_id, org_id) matches no row.
      await expect(
        prisma.secretAttachment.create({ data: { ...base, storageObjectId: otherObjects[0], orgId: defaultOrg } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      // And the object's own id with the wrong org label.
      await expect(
        prisma.secretAttachment.create({ data: { ...base, storageObjectId: defaultObjects[2], orgId: otherOrg } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it("accepts an attachment carrying the object's own organization", async () => {
      const base = await seedVersion();
      const row = await prisma.secretAttachment.create({ data: { ...base, storageObjectId: otherObjects[0], orgId: otherOrg } });
      expect(row.orgId).toBe(otherOrg);
    });

    it('has org_id NOT NULL', async () => {
      const { rows } = await app.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'secret_attachments' AND column_name = 'org_id'`,
      );
      expect(rows[0].is_nullable).toBe('NO');
    });
  });

  describe("Vault's default-organization scope", () => {
    it('resolves the default organization (the unscoped organizations table is readable)', async () => {
      expect(await getDefaultOrgId(prisma)).toBe(defaultOrg);
    });

    it('runInDefaultOrg and defaultOrgClient see the default org, not the other', async () => {
      const viaRun = await runInDefaultOrg(prisma, (tx) => tx.storageObject.count());
      const viaClient = await defaultOrgClient(prisma).storageObject.count();
      expect(viaRun).toBe(defaultObjects.length);
      expect(viaClient).toBe(defaultObjects.length);
    });

    describe('attachments joined through storage_objects', () => {
      let secretId: string;
      let versionId: string;
      let objectId: string;
      let attachmentId: string;

      beforeAll(async () => {
        const user = await prisma.user.create({ data: { email: `att-${randomUUID()}@example.test` } });
        const type = await prisma.secretType.create({
          data: { name: `rls-type-${randomUUID()}`, fields: [], allowAttachments: true },
        });
        const secret = await prisma.secret.create({
          data: { name: 'rls secret', typeId: type.id, createdById: user.id },
        });
        const version = await prisma.secretVersion.create({
          data: { secretId: secret.id, version: 1, encryptedData: 'x', iv: 'y', authTag: 'z', isCurrent: true },
        });
        objectId = defaultObjects[0];
        const attachment = await prisma.secretAttachment.create({
          data: { secretId: secret.id, secretVersionId: version.id, storageObjectId: objectId, orgId: defaultOrg, label: 'doc' },
        });
        secretId = secret.id;
        versionId = version.id;
        attachmentId = attachment.id;
      });

      it('an unscoped include of the (required) storage object silently comes back null', async () => {
        // The failure mode the wrapper exists for: no error, the file just vanishes.
        const rows = await prisma.secretAttachment.findMany({ where: { secretId }, include: { storageObject: true } });
        expect(rows).toHaveLength(1);
        expect(rows[0].storageObject).toBeNull();
      });

      it('the scoped client returns the attachment with its storage object', async () => {
        const rows = await defaultOrgClient(prisma).secretAttachment.findMany({
          where: { secretId, secretVersionId: versionId },
          include: { storageObject: true },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].storageObject.id).toBe(objectId);
      });

      it('the FOR UPDATE unlink transaction locks, counts and deletes the object under RLS', async () => {
        const deleted = await runInDefaultOrg(prisma, async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM storage_objects WHERE id = ${objectId}::uuid FOR UPDATE`;
          expect(locked).toHaveLength(1);
          await tx.secretAttachment.delete({ where: { id: attachmentId } });
          const remaining = await tx.secretAttachment.count({ where: { storageObjectId: objectId } });
          if (remaining > 0) return false;
          await tx.storageObject.delete({ where: { id: objectId } });
          return true;
        });
        expect(deleted).toBe(true);
        expect(await runInDefaultOrg(prisma, (tx) => tx.storageObject.count({ where: { id: objectId } }))).toBe(0);
      });
    });
  });
});
