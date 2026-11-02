import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * scripts/baseline-deviations.mjs turns the BLOCKING statements of a saved
 * `platform db baseline --through 2` dry run into `platform.lock` deviations
 * (E2.2, #74). On a PLATFORM table it may excuse only (a) an `id` DROP DEFAULT
 * that an app-only migration also does and (b) the three
 * storage_objects.media_folder_id statements; every other statement has to
 * name a table or enum that an app-only migration creates. Anything else is a
 * real difference and the script must refuse it (exit 1).
 */

const API_DIR = resolve(__dirname, '..', '..');
const SCRIPT = join(API_DIR, 'scripts', 'baseline-deviations.mjs');

const USERS_DEFAULT = 'ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;';
const ROLES_DEFAULT = 'ALTER TABLE "roles" ALTER COLUMN "id" DROP DEFAULT;';
const MEDIA_COLUMN = 'ALTER TABLE "storage_objects" ADD COLUMN "media_folder_id" UUID, ALTER COLUMN "id" DROP DEFAULT;';
const MEDIA_INDEX = 'CREATE INDEX "storage_objects_media_folder_id_idx" ON "storage_objects"("media_folder_id" ASC);';
const MEDIA_FK =
  'ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_media_folder_id_fkey" FOREIGN KEY ("media_folder_id") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;';
const WIDGET_TYPE = `CREATE TYPE "WidgetState" AS ENUM ('a', 'b');`;
const WIDGET_TABLE =
  'CREATE TABLE "widgets" ( "id" UUID NOT NULL, "owner_id" UUID NOT NULL, "state" "WidgetState" NOT NULL, CONSTRAINT "widgets_pkey" PRIMARY KEY ("id") );';
const WIDGET_FK =
  'ALTER TABLE "widgets" ADD CONSTRAINT "widgets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;';
const WIDGET_INDEX = 'CREATE UNIQUE INDEX "widgets_owner_id_key" ON "widgets"("owner_id" ASC);';
const LINK_TABLE =
  'CREATE TABLE "media_folder_files" ( "object_id" UUID NOT NULL, CONSTRAINT "media_folder_files_pkey" PRIMARY KEY ("object_id") );';
const LINK_INDEX = 'CREATE INDEX "media_folder_files_media_folder_id_idx" ON "media_folder_files"("media_folder_id" ASC);';

describe('scripts/baseline-deviations.mjs', () => {
  let dir: string;
  let migrations: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'baseline-dev-'));
    migrations = join(dir, 'migrations');
    const app: Array<[string, string]> = [
      [
        '20260403235813_add_media_folders',
        // users' default is dropped here; roles' is NOT (so declaring it must be refused).
        `${USERS_DEFAULT}\n-- AlterTable\nALTER TABLE "storage_objects" ADD COLUMN     "media_folder_id" UUID,\nALTER COLUMN "id" DROP DEFAULT;\n`,
      ],
      ['20260915000000_add_widgets', `${WIDGET_TYPE}\n${WIDGET_TABLE}\n${WIDGET_FK}\n`],
      ['20261102130000_add_media_folder_files', `${LINK_TABLE}\n`],
    ];
    for (const [name, sql] of app) {
      mkdirSync(join(migrations, name), { recursive: true });
      writeFileSync(join(migrations, name, 'migration.sql'), sql);
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(statements: string[]) {
    const report = [
      'B1 map: 2 matched, 38 unmatched, 3 app-only',
      '  app-only: 20260403235813_add_media_folders',
      '  app-only: 20260915000000_add_widgets',
      '  app-only: 20261102130000_add_media_folder_files',
      '',
      `B3 diff: ${statements.length} blocking, 0 declared`,
      ...statements.map((s) => `  BLOCKING: ${s}`),
      '',
    ].join('\n');
    const file = join(dir, 'report.txt');
    writeFileSync(file, report);
    return spawnSync(process.execPath, [SCRIPT, file, '--migrations', migrations], { encoding: 'utf8' });
  }

  it('sorts statements into the early id default, media_folder_id, media_folder_files and domain deviations', () => {
    const res = run([
      USERS_DEFAULT,
      MEDIA_COLUMN,
      WIDGET_TYPE,
      WIDGET_TABLE,
      MEDIA_INDEX,
      WIDGET_FK,
      MEDIA_FK,
      WIDGET_INDEX,
      LINK_TABLE,
      LINK_INDEX,
    ]);
    expect(res.status).toBe(0);
    const deviations = JSON.parse(res.stdout);
    expect(deviations.map((d: { id: string }) => d.id)).toEqual([
      'vault:pre-0005-uuid-defaults',
      'vault:storage-media-folder-id',
      'vault:media-folder-files',
      'vault:domain-schema',
    ]);
    expect(deviations[0].expectDiff).toEqual([USERS_DEFAULT]);
    expect(deviations[1].expectDiff).toEqual([MEDIA_COLUMN, MEDIA_INDEX, MEDIA_FK]);
    expect(deviations[2].expectDiff).toEqual([LINK_TABLE, LINK_INDEX]);
    expect(deviations[3].expectDiff).toEqual([WIDGET_TYPE, WIDGET_TABLE, WIDGET_FK, WIDGET_INDEX]);
    expect(deviations[3].reason).toContain('not a change to a platform table');
  });

  it('refuses an id DROP DEFAULT that no app-only migration does', () => {
    const res = run([WIDGET_TABLE, ROLES_DEFAULT]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('REFUSED');
    expect(res.stderr).toContain('"roles"');
    expect(res.stdout).toBe('');
  });

  it('refuses a new column on a platform table', () => {
    const res = run([WIDGET_TABLE, 'ALTER TABLE "users" ADD COLUMN "nickname" TEXT;']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('"users"');
  });

  it('refuses a storage_objects column other than media_folder_id', () => {
    const res = run(['ALTER TABLE "storage_objects" ADD COLUMN "sneaky" TEXT, ALTER COLUMN "id" DROP DEFAULT;']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('storage_objects');
  });

  it('refuses an index, constraint or type on a platform object', () => {
    for (const statement of [
      'CREATE INDEX "users_nick_idx" ON "users"("email" ASC);',
      'ALTER TABLE "jobs" ADD CONSTRAINT "jobs_x_fkey" FOREIGN KEY ("x") REFERENCES "users"("id");',
      `CREATE TYPE "JobKind" AS ENUM ('a');`,
    ]) {
      const res = run([WIDGET_TABLE, statement]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(statement);
    }
  });

  it('refuses a statement shape it does not recognise', () => {
    expect(run(['DROP TABLE "users";']).status).toBe(1);
  });

  it('answers 2 when the report has no dry-run data', () => {
    const file = join(dir, 'empty.txt');
    writeFileSync(file, 'nothing here\n');
    const res = spawnSync(process.execPath, [SCRIPT, file, '--migrations', migrations], { encoding: 'utf8' });
    expect(res.status).toBe(2);
  });
});
