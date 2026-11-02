import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';

import { buildDatabaseUrl } from '../../src/common/database-url';

/**
 * Real-Postgres proof of migration 20261102130000_add_media_folder_files
 * (E2.2, #74): it moves storage_objects.media_folder_id into
 * media_folder_files WITHOUT losing a link.
 *
 * Builds a scratch database from every migration that sorts BEFORE it (the
 * original seven, then the installed platform 0003-0040), loads rows the way
 * the old column held them, applies the migration, and checks the result.
 * Needs a role that can create databases (the CI service user can).
 */
const MIGRATION = '20261102130000_add_media_folder_files';
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

function adminUrl(): { url: string; dbName: string } {
  const base = new URL(buildDatabaseUrl());
  const dbName = `vault_mff_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  base.pathname = '/postgres';
  return { url: base.toString(), dbName };
}

describe('migration add_media_folder_files (real Postgres)', () => {
  const { url: admin, dbName } = adminUrl();
  let db: Client;

  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const USER = '00000000-0000-4000-8000-000000000001';
  const FOLDER_A = '00000000-0000-4000-8000-0000000000d1';
  const FOLDER_B = '00000000-0000-4000-8000-0000000000d2';
  const obj = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;

  beforeAll(async () => {
    const root = new Client({ connectionString: admin });
    await root.connect();
    await root.query(`CREATE DATABASE "${dbName}"`);
    await root.end();

    const target = new URL(admin);
    target.pathname = `/${dbName}`;
    db = new Client({ connectionString: target.toString() });
    await db.connect();

    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name < MIGRATION)
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      await db.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    }

    // The state before the migration: the column holds the links.
    await db.query(`
      INSERT INTO organizations (id, name, slug, is_default, updated_at)
        VALUES ('${ORG}', 'Org Alpha', 'org-alpha', false, now()) ON CONFLICT DO NOTHING;
      INSERT INTO users (id, email, updated_at) VALUES ('${USER}', 'a@example.test', now());
      INSERT INTO media_folders (id, name, user_id, updated_at) VALUES
        ('${FOLDER_A}', 'A', '${USER}', now()), ('${FOLDER_B}', 'B', '${USER}', now());
    `);
    await db.query(`BEGIN; SELECT set_config('app.rls_bypass', 'on', true);
      INSERT INTO storage_objects (id, org_id, name, size, mime_type, storage_key, status, uploaded_by_id, media_folder_id, updated_at) VALUES
        ('${obj(1)}', '${ORG}', 'one.png', 1, 'image/png', 'k/1', 'ready', '${USER}', '${FOLDER_A}', now()),
        ('${obj(2)}', '${ORG}', 'two.png', 1, 'image/png', 'k/2', 'ready', '${USER}', '${FOLDER_B}', now()),
        ('${obj(3)}', '${ORG}', 'loose.png', 1, 'image/png', 'k/3', 'ready', '${USER}', NULL, now());
      COMMIT;`);

    await db.query(readFileSync(join(MIGRATIONS_DIR, MIGRATION, 'migration.sql'), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    const root = new Client({ connectionString: admin });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await root.end();
  });

  it('preserves every link and creates none for an unfiled object', async () => {
    const { rows } = await db.query(
      'SELECT object_id, org_id, media_folder_id FROM media_folder_files ORDER BY object_id',
    );
    expect(rows).toEqual([
      { object_id: obj(1), org_id: ORG, media_folder_id: FOLDER_A },
      { object_id: obj(2), org_id: ORG, media_folder_id: FOLDER_B },
    ]);
  });

  it('drops the column, its index and its foreign key', async () => {
    const col = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'storage_objects' AND column_name = 'media_folder_id'`,
    );
    expect(col.rowCount).toBe(0);
    const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'storage_objects_media_folder_id_idx'`);
    expect(idx.rowCount).toBe(0);
  });

  it('deleting a folder removes only the link: the object survives, unfiled', async () => {
    await db.query(`DELETE FROM media_folders WHERE id = '${FOLDER_B}'`);
    const links = await db.query(`SELECT 1 FROM media_folder_files WHERE object_id = '${obj(2)}'`);
    expect(links.rowCount).toBe(0);
    await db.query(`BEGIN; SELECT set_config('app.rls_bypass', 'on', true);`);
    const objects = await db.query(`SELECT 1 FROM storage_objects WHERE id = '${obj(2)}'`);
    await db.query('COMMIT');
    expect(objects.rowCount).toBe(1);
  });

  it('deleting the object removes its link', async () => {
    await db.query(`BEGIN; SELECT set_config('app.rls_bypass', 'on', true);
      DELETE FROM storage_objects WHERE id = '${obj(1)}'; COMMIT;`);
    const links = await db.query(`SELECT 1 FROM media_folder_files WHERE object_id = '${obj(1)}'`);
    expect(links.rowCount).toBe(0);
  });

  it('refuses a link whose org_id does not match the object (composite foreign key)', async () => {
    await expect(
      db.query(
        `INSERT INTO media_folder_files (object_id, org_id, media_folder_id) VALUES ('${obj(3)}', '${USER}', '${FOLDER_A}')`,
      ),
    ).rejects.toThrow(/media_folder_files_object_id_org_id_fkey/);
  });
});
