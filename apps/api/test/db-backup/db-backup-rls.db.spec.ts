// =============================================================================
// Real-Postgres test: the whole-database dump carries EVERY row of a database whose
// tables FORCE row-level security (issue #89, E9.1, epic #64)
// =============================================================================
//
// THE FAILURE THIS SUITE EXISTS FOR IS SILENT. With row-level security forced on the
// `org` tables, `pg_dump --enable-row-security` WITHOUT the `app.rls_bypass` startup option
// exits 0 and writes a plausible, valid archive that holds the schema and NO ROWS. Nothing
// errors until the day somebody restores it. The PAIR (flag in argv + option in the
// ENVIRONMENT, never argv) is what makes a dump complete, and only a real server proves it.
//
// It builds Vault's real schema owned by an ORDINARY role (`provisionAppRoleDatabase`, the same
// deployment `rls/storage-isolation.db.spec.ts` uses), because a superuser ignores every
// policy and would pass a broken dump. Two organizations each write storage objects as that
// role, then:
//
//   1. the dump `spawnPgDump` builds (the engine's own function) is spawned through a capturing
//      seam: argv carries `--enable-row-security` and NEVER the bypass option, the environment
//      carries `PGOPTIONS=-c app.rls_bypass=on`, and no password reaches argv;
//   2. the archive is non-empty and restores (`spawnPgRestore`, the restore's own function)
//      into a fresh database with every row of BOTH organizations, and the restored database
//      STILL enforces isolation;
//   3. NEGATIVE CONTROL: the flag without the option exits 0 and restores to empty tables.
//
// It needs `pg_dump` and `pg_restore` (major >= the server's; the dev image installs
// postgresql17-client) and skips, with the reason on the console, when either is missing or
// no Postgres superuser is reachable. Excluded from `npm test`; runs in `npm run test:db`.
// =============================================================================

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Client } from 'pg';

import { RLS_BYPASS_PGOPTIONS } from '@marinoscar/platform-api/db-backup';
import {
  PG_DUMP_COMMAND,
  buildPgDumpArgs,
  pgClientEnv,
  resolvePgConnection,
  spawnPgDump,
  spawnPgProcess,
  spawnPgRestore,
  type PgConnection,
  type PgSpawnFn,
} from '@marinoscar/platform-api/db-backup/testing';

import {
  findAdminCredentials,
  provisionAppRoleDatabase,
  type AppRoleDatabase,
} from '../helpers/app-role-database.helper';

const admin = findAdminCredentials();

/** The first line of `<tool> --version`, or null when the binary is not on PATH. */
function toolVersion(tool: string): string | null {
  try {
    return execFileSync(tool, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

const pgDump = toolVersion('pg_dump');
const pgRestore = toolVersion('pg_restore');

const skipReason = !admin
  ? `no superuser reachable at ${process.env.POSTGRES_HOST ?? '(POSTGRES_HOST unset)'}:${process.env.POSTGRES_PORT ?? '5432'} to bootstrap the application role with`
  : !pgDump || !pgRestore
    ? `pg_dump / pg_restore are not on PATH (pg_dump: ${pgDump ?? 'missing'}, pg_restore: ${pgRestore ?? 'missing'}); install postgresql-client`
    : null;

if (skipReason) {
  // eslint-disable-next-line no-console
  console.warn(`\n[db-backup-rls.db.spec] SKIPPED: ${skipReason}.\n`);
}

const describeWithDb = skipReason ? describe.skip : describe;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describeWithDb('the whole-database dump with row-level security forced (real Postgres, ordinary role)', () => {
  let deployment: AppRoleDatabase;
  let connection: PgConnection;
  let defaultOrg: string;
  const otherOrg = randomUUID();
  const siblings: string[] = [];

  /** A scoped batch as the role: `app.org_id` is transaction-local, like production. */
  async function asOrg(orgId: string, fn: (client: Client) => Promise<void>): Promise<void> {
    const client = deployment.appClient();
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await fn(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  async function seed(orgId: string, count: number): Promise<void> {
    await asOrg(orgId, async (client) => {
      for (let i = 0; i < count; i += 1) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO storage_objects (id, name, size, mime_type, storage_key, updated_at, org_id)
           VALUES ($1, $2, 1024, 'application/pdf', $3, now(), $4)`,
          [id, `${id}.pdf`, `db-backup-rls/${id}`, orgId],
        );
      }
    });
  }

  /** A fresh database owned by the application role, to restore into. */
  async function createSibling(label: string): Promise<string> {
    const name = `${deployment.database}_${label}`;
    const maintenance = new Client({ host: admin!.host, port: admin!.port, user: admin!.user, password: admin!.password, database: 'postgres' });
    await maintenance.connect();
    try {
      await maintenance.query(`CREATE DATABASE "${name}" OWNER "${deployment.role}"`);
    } finally {
      await maintenance.end();
    }
    siblings.push(name);
    return name;
  }

  /** Rows per organization in `database`, counted by the superuser (policies do not apply to it). */
  async function truthIn(database: string): Promise<Record<string, number>> {
    const client = new Client({ host: admin!.host, port: admin!.port, user: admin!.user, password: admin!.password, database });
    await client.connect();
    try {
      const { rows } = await client.query<{ org: string; n: number }>(
        'SELECT org_id::text AS org, count(*)::int AS n FROM storage_objects GROUP BY org_id',
      );
      return Object.fromEntries(rows.map((row) => [row.org, row.n]));
    } finally {
      await client.end();
    }
  }

  /** Rows `org` (or nobody, when null) sees in `database` as the ordinary role, without the bypass. */
  async function scopedCount(database: string, org: string | null): Promise<number> {
    const client = new Client({ host: admin!.host, port: admin!.port, user: deployment.role, password: deployment.password, database });
    await client.connect();
    try {
      await client.query('BEGIN');
      if (org) await client.query(`SELECT set_config('app.org_id', $1, true)`, [org]);
      const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM storage_objects');
      await client.query('ROLLBACK');
      return rows[0].n;
    } finally {
      await client.end();
    }
  }

  async function restore(archive: Buffer, database: string): Promise<void> {
    const restoring = spawnPgRestore({ connection: { ...connection, database }, stdin: Readable.from([archive]) });
    restoring.stdout.resume();
    await restoring.done;
  }

  beforeAll(async () => {
    deployment = await provisionAppRoleDatabase(admin!);
    connection = resolvePgConnection(deployment.env);

    const bootstrap = deployment.adminClient();
    await bootstrap.connect();
    try {
      defaultOrg = (await bootstrap.query('SELECT id FROM organizations WHERE is_default')).rows[0].id;
    } finally {
      await bootstrap.end();
    }
    const app = deployment.appClient();
    await app.connect();
    try {
      await app.query(
        `INSERT INTO organizations (id, name, slug, is_default, updated_at) VALUES ($1, 'Other', $2, false, now())`,
        [otherOrg, `db-backup-${otherOrg.slice(0, 8)}`],
      );
    } finally {
      await app.end();
    }
    await seed(defaultOrg, 3);
    await seed(otherOrg, 2);
  }, 240_000);

  afterAll(async () => {
    if (siblings.length > 0 && admin) {
      const cleanup = new Client({ host: admin.host, port: admin.port, user: admin.user, password: admin.password, database: 'postgres' });
      await cleanup.connect().catch(() => undefined);
      for (const name of siblings) await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
      await cleanup.end().catch(() => undefined);
    }
    await deployment?.drop();
  }, 60_000);

  it('starts from an ordinary role and a database split across two organizations', async () => {
    expect(await truthIn(deployment.database)).toEqual({ [defaultOrg]: 3, [otherOrg]: 2 });
    // Unscoped, the ordinary role sees nothing: the policies bite, so a dump that did not lift them would be empty.
    expect(await scopedCount(deployment.database, null)).toBe(0);
    expect(await scopedCount(deployment.database, defaultOrg)).toBe(3);
  });

  it('spawns pg_dump with --enable-row-security in argv and PGOPTIONS=-c app.rls_bypass=on in the ENVIRONMENT only', async () => {
    const seen: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const capturing: PgSpawnFn = (command, args, options) => {
      seen.push({ command, args: [...args], env: { ...options.env } });
      return spawn(command, args, options);
    };

    const dumping = spawnPgDump({ connection, spawnFn: capturing });
    const [archive] = await Promise.all([collect(dumping.stdout), dumping.done]);

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call.command).toBe(PG_DUMP_COMMAND);
    expect(call.args).toContain('--enable-row-security');
    // The option is in the environment, never in argv (and so never in `ps` or a log line).
    expect(call.env.PGOPTIONS).toContain('-c app.rls_bypass=on');
    expect(call.env.PGOPTIONS).toContain(RLS_BYPASS_PGOPTIONS);
    expect(call.args.join(' ')).not.toMatch(/rls_bypass|PGOPTIONS/);
    // Nor does the password: it travels as PGPASSWORD.
    expect(call.args.join(' ')).not.toContain(connection.password);

    // Non-empty, and a custom-format archive ("PGDMP" magic).
    expect(archive.length).toBeGreaterThan(0);
    expect(archive.subarray(0, 5).toString('latin1')).toBe('PGDMP');
  }, 120_000);

  it('restores every row of BOTH organizations from that dump, and the restored database still enforces isolation', async () => {
    const dumping = spawnPgDump({ connection });
    const [archive] = await Promise.all([collect(dumping.stdout), dumping.done]);

    const target = await createSibling('restored');
    await restore(archive, target);

    expect(await truthIn(target)).toEqual({ [defaultOrg]: 3, [otherOrg]: 2 });

    // Forced RLS and the policies travelled with the data: unscoped sees nothing, each org its own.
    expect(await scopedCount(target, null)).toBe(0);
    expect(await scopedCount(target, defaultOrg)).toBe(3);
    expect(await scopedCount(target, otherOrg)).toBe(2);
  }, 180_000);

  it('NEGATIVE CONTROL: --enable-row-security WITHOUT the startup option exits 0 and restores to empty org tables', async () => {
    const flagOnly = spawnPgProcess({
      command: PG_DUMP_COMMAND,
      args: buildPgDumpArgs({ connection }),
      password: connection.password,
      // The connection facts only: no PGOPTIONS. This is what the engine must never do.
      extraEnv: pgClientEnv(connection),
      baseEnv: { ...process.env, PGOPTIONS: '' },
    });
    const [archive] = await Promise.all([collect(flagOnly.stdout), flagOnly.done]);
    expect(archive.length).toBeGreaterThan(0);

    const target = await createSibling('empty');
    await restore(archive, target);

    expect(await truthIn(target)).toEqual({});
  }, 180_000);
});
