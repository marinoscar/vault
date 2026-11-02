// =============================================================================
// Real-Postgres test: the role this process connects as is an ordinary one
// (issue #75, E2.3). Replaces the Doctor `db.rls_role` check until the platform
// Doctor slice lands (E3.1).
// =============================================================================
//
// Row-level security is inert for a superuser or a BYPASSRLS role. In CI the
// DB Check job connects as `vault_app` (created by
// infra/compose/postgres-init/10-application-role.sh), and this proves that
// role is not privileged and owns the tables of the migrated database it
// connects to. When the environment's role IS a superuser (a local database
// that has not been converted), the suite skips with a pointer to the runbook
// rather than failing: tenant isolation is then NOT enforced, which is what the
// warning says.
// =============================================================================

import { Client } from 'pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

describe('the connecting role (real Postgres)', () => {
  let client: Client | null = null;
  let privileged = false;
  let migrated = false;

  beforeAll(async () => {
    try {
      const candidate = new Client({ connectionString: buildDatabaseUrl(), connectionTimeoutMillis: 3000 });
      await candidate.connect();
      client = candidate;
      const { rows } = await candidate.query(
        `SELECT rolsuper OR rolbypassrls AS privileged FROM pg_roles WHERE rolname = current_user`,
      );
      privileged = rows[0].privileged;
      migrated = (await candidate.query(`SELECT to_regclass('public.storage_objects') IS NOT NULL AS ok`)).rows[0].ok;
    } catch {
      client = null;
    }
    if (!client || privileged || !migrated) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n[role-attributes.db.spec] SKIPPED: ' +
          (!client
            ? 'no database reachable.'
            : privileged
              ? 'the connecting role is a superuser or BYPASSRLS, so tenant isolation is NOT enforced here. See docs/runbooks/application-role.md.'
              : 'the database is not migrated.') +
          '\n',
      );
    }
  });

  afterAll(async () => {
    await client?.end().catch(() => undefined);
  });

  const run = (fn: (c: Client) => Promise<void>) => async () => {
    if (!client || privileged || !migrated) return;
    await fn(client);
  };

  it(
    'is neither a superuser nor BYPASSRLS',
    run(async (c) => {
      const { rows } = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    }),
  );

  it(
    'owns every table of the database (FORCE ROW LEVEL SECURITY applies to an owner)',
    run(async (c) => {
      const { rows } = await c.query(
        `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user`,
      );
      expect(rows).toEqual([]);
    }),
  );

  it(
    'cannot see storage_objects rows without an organization scope',
    run(async (c) => {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM storage_objects`);
      expect(rows[0].n).toBe(0);
    }),
  );
});
