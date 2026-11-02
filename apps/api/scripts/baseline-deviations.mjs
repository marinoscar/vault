#!/usr/bin/env node
/**
 * baseline-deviations.mjs - TEMPORARY tooling for Vault's platform baseline (E2.2).
 *
 * `platform db baseline --through 2 --allow-rls` diffs the platform history up
 * to 0002 against the live database (B3) and prints every statement the
 * database has that the platform history does not, as `BLOCKING:` lines. For
 * Vault that is (a) every object of the seven domain tables the app-only
 * migrations created, (b) the `id` defaults that Vault's
 * `20260403235813_add_media_folders` already dropped on twelve platform tables
 * (platform migration 0005 does the same later and is then a no-op), and
 * (c) the `storage_objects.media_folder_id` column, index and foreign key that
 * the app migration `..._add_media_folder_files` removes again.
 *
 * Pasting ~50 statements into `platform.lock` by hand would be an unverifiable
 * act of faith, so this script reads a SAVED dry-run report and proves each
 * statement before it turns it into a `deviations` entry:
 *
 *   - `ALTER TABLE "t" ALTER COLUMN "id" DROP DEFAULT;` on one of the twelve
 *     platform tables is accepted only when an app-only migration contains
 *     that exact statement;
 *   - the three `storage_objects.media_folder_id` statements are the ONLY
 *     other thing that may touch a platform table, and the column must be
 *     added by an app-only migration;
 *   - every other statement must target a table or enum type that an app-only
 *     migration CREATEs (a Vault domain object). A foreign key FROM a domain
 *     table TO a platform table is fine (it alters the domain table);
 *   - anything else is a REAL difference between the live database and the
 *     platform history. The script exits 1 and prints it. Stop and report it;
 *     never declare it.
 *
 * Usage:
 *   node scripts/baseline-deviations.mjs <report.txt> [--migrations <dir>]
 *                                        [--lock <platform.lock> --write]
 *
 * Exit codes: 0 all statements proven, 1 a statement was refused, 2 usage error.
 *
 * Removed with the deviations: the media-folder entry when the
 * `..._add_media_folder_files` migration is installed everywhere; the rest stay
 * for as long as the database was baselined from this history.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Platform tables whose `id` default Vault's add_media_folders migration
 * dropped early (platform 0005_drop_stale_uuid_defaults drops the same ones).
 */
export const UUID_DEFAULT_TABLES = [
  'allowed_emails',
  'audit_events',
  'device_codes',
  'permissions',
  'refresh_tokens',
  'roles',
  'storage_object_chunks',
  'storage_objects',
  'system_settings',
  'user_identities',
  'user_settings',
  'users',
];

export const UUID_DEFAULTS_ID = 'vault:pre-0005-uuid-defaults';
export const MEDIA_FOLDER_ID = 'vault:storage-media-folder-id';
export const DOMAIN_ID = 'vault:domain-schema';
export const MEDIA_FILES_ID = 'vault:media-folder-files';

const REASONS = {
  [UUID_DEFAULTS_ID]:
    'Vault migration 20260403235813_add_media_folders already dropped the id default on these platform tables, which platform migration 0005_drop_stale_uuid_defaults does later. The statement is a no-op when 0005 runs on this database. (The storage_objects one is printed together with the media_folder_id column, see vault:storage-media-folder-id.)',
  [MEDIA_FOLDER_ID]:
    'Vault-only column storage_objects.media_folder_id with its index and foreign key (migration 20260403235813_add_media_folders). Temporary: the app migration ..._add_media_folder_files moves the link into media_folder_files and drops the column. The combined ALTER also carries the early id DROP DEFAULT of vault:pre-0005-uuid-defaults.',
  [MEDIA_FILES_ID]:
    'Table media_folder_files (migration 20261102130000_add_media_folder_files), which replaces storage_objects.media_folder_id. It appears in the diff only once that migration is applied, i.e. in a dry run AFTER prisma:migrate.',
  [DOMAIN_ID]:
    'Vault domain tables (secret_types, secrets, secret_versions, secret_attachments, media_folders, backup_schedules, backup_runs) created by app-only migrations; not a change to a platform table.',
};

/** Same normalisation the baseline applies before comparing a statement to `expectDiff`. */
export function normaliseStatement(statement) {
  return statement.replace(/"public"\./g, '').replace(/\s+/g, ' ').trim();
}

/** The `BLOCKING:` statements of a saved dry-run report, in report order. */
export function parseBlockingStatements(report) {
  return report
    .split(/\r?\n/)
    .filter((l) => /^\s*BLOCKING:\s/.test(l))
    .map((l) => normaliseStatement(l.replace(/^\s*BLOCKING:\s*/, '')));
}

/** The `app-only: <dir>` directories of a saved dry-run report. */
export function parseAppOnlyDirectories(report) {
  return report
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*app-only:\s+(\S+)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const IDENT = '"?([A-Za-z_][A-Za-z0-9_]*)"?';

/**
 * What the app-only migrations create and which platform columns they add.
 *
 * @param {Array<[string, string]>} migrations `[directory, sql]` of the app-only migrations.
 */
export function collectAppObjects(migrations) {
  const tables = new Set();
  const types = new Set();
  const addedColumns = new Set(); // `table.column`
  const droppedIdDefaults = new Set(); // table names
  for (const [, rawSql] of migrations) {
    const sql = stripSqlComments(rawSql);
    for (const m of sql.matchAll(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?${IDENT}`, 'gi'))) {
      tables.add(m[1]);
    }
    for (const m of sql.matchAll(new RegExp(`CREATE\\s+TYPE\\s+(?:"?public"?\\.)?${IDENT}`, 'gi'))) {
      types.add(m[1]);
    }
    for (const stmt of sql.split(';')) {
      const alter = stmt.match(new RegExp(`^\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?${IDENT}\\s+([\\s\\S]*)$`, 'i'));
      if (!alter) continue;
      // `ALTER TABLE t ALTER COLUMN "id" DROP DEFAULT`, alone or as one clause of several.
      if (/(?:^|,)\s*ALTER\s+COLUMN\s+"?id"?\s+DROP\s+DEFAULT\s*(?:,|$)/i.test(alter[2])) {
        droppedIdDefaults.add(alter[1]);
      }
      for (const col of alter[2].matchAll(new RegExp(`ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'gi'))) {
        addedColumns.add(`${alter[1]}.${col[1]}`);
      }
    }
  }
  return { tables, types, addedColumns, droppedIdDefaults };
}

/**
 * The object a statement is about: the table or type it creates or alters, or
 * the table an index is built on. `null` when the statement is not one of the
 * shapes `prisma migrate diff` prints for an added object.
 */
export function statementTarget(statement) {
  const patterns = [
    [new RegExp(`^CREATE TYPE ${IDENT}\\b`, 'i'), 'type'],
    [new RegExp(`^CREATE TABLE ${IDENT}\\b`, 'i'), 'table'],
    [new RegExp(`^ALTER TABLE ${IDENT}\\b`, 'i'), 'table'],
    [new RegExp(`^CREATE (?:UNIQUE )?INDEX ${IDENT} ON ${IDENT}\\b`, 'i'), 'index'],
  ];
  for (const [re, kind] of patterns) {
    const m = statement.match(re);
    if (m) return { kind, name: kind === 'index' ? m[2] : m[1] };
  }
  return null;
}

const MEDIA_COMBINED = new RegExp(
  `^ALTER TABLE ${IDENT} ADD COLUMN "?media_folder_id"? UUID, ALTER COLUMN "?id"? DROP DEFAULT;?$`,
  'i',
);
const ID_DEFAULT_ONLY = new RegExp(`^ALTER TABLE ${IDENT} ALTER COLUMN "?id"? DROP DEFAULT;?$`, 'i');

/**
 * Which platform-table deviation a statement is, or null. Only the two shapes
 * named in the header qualify.
 */
function matchPlatformTableStatement(statement, target, appObjects) {
  if (!UUID_DEFAULT_TABLES.includes(target.name)) return null;
  // The id default dropped early by an app migration.
  const idOnly = statement.match(ID_DEFAULT_ONLY);
  if (idOnly && appObjects.droppedIdDefaults.has(idOnly[1])) return UUID_DEFAULTS_ID;
  if (target.name !== 'storage_objects') return null;
  // storage_objects.media_folder_id: column (printed with the id default), index, foreign key.
  if (
    MEDIA_COMBINED.test(statement) &&
    appObjects.addedColumns.has('storage_objects.media_folder_id') &&
    appObjects.droppedIdDefaults.has('storage_objects')
  ) {
    return MEDIA_FOLDER_ID;
  }
  if (/^CREATE INDEX "?storage_objects_media_folder_id_idx"? ON "?storage_objects"?\(/i.test(statement)) {
    return MEDIA_FOLDER_ID;
  }
  if (/^ALTER TABLE "?storage_objects"? ADD CONSTRAINT "?storage_objects_media_folder_id_fkey"? FOREIGN KEY \("?media_folder_id"?\) REFERENCES "?media_folders"?\("?id"?\)/i.test(statement)) {
    return MEDIA_FOLDER_ID;
  }
  return null;
}

/**
 * Classifies every statement.
 *
 * @returns `{ entries, refused }`: `entries` maps deviation id to its statements;
 *   `refused` lists `{ statement, why }` for every statement that is not proven.
 */
export function classify(statements, appObjects) {
  const entries = Object.fromEntries([UUID_DEFAULTS_ID, MEDIA_FOLDER_ID, MEDIA_FILES_ID, DOMAIN_ID].map((id) => [id, []]));
  const refused = [];
  for (const statement of statements) {
    const target = statementTarget(statement);
    if (!target) {
      refused.push({ statement, why: 'not a statement shape that creates or alters a Vault domain object' });
      continue;
    }
    // 1. A platform table may differ only by the shapes in the header.
    if (UUID_DEFAULT_TABLES.includes(target.name) && target.kind !== 'type') {
      const id = matchPlatformTableStatement(statement, target, appObjects);
      if (id) entries[id].push(statement);
      else {
        refused.push({
          statement,
          why: `touches platform table "${target.name}" and is not an id DROP DEFAULT done by an app-only migration or a storage_objects.media_folder_id statement`,
        });
      }
      continue;
    }
    // 2. Everything else must belong to a table or type an app-only migration creates.
    const known = target.kind === 'type' ? appObjects.types.has(target.name) : appObjects.tables.has(target.name);
    if (!known) {
      refused.push({
        statement,
        why: `"${target.name}" is not a table or type created by an app-only migration, so this is a platform object: a real difference`,
      });
      continue;
    }
    entries[target.name === 'media_folder_files' ? MEDIA_FILES_ID : DOMAIN_ID].push(statement);
  }
  return { entries, refused };
}

/** The `deviations` entries, in the order the issue lists them. Empty entries are omitted. */
export function buildDeviations(entries) {
  const order = [UUID_DEFAULTS_ID, MEDIA_FOLDER_ID, MEDIA_FILES_ID, DOMAIN_ID];
  return order
    .filter((id) => entries[id].length > 0)
    .map((id) => ({ id, reason: REASONS[id], expectDiff: entries[id] }));
}

function readMigrations(migrationsDir, dirs) {
  return dirs.map((d) => {
    const file = join(migrationsDir, d, 'migration.sql');
    if (!existsSync(file)) throw new Error(`app-only migration ${d} has no migration.sql in ${migrationsDir}`);
    return [d, readFileSync(file, 'utf8')];
  });
}

function parseArgs(argv) {
  const args = { report: null, migrations: null, lock: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--migrations') args.migrations = argv[++i];
    else if (a === '--lock') args.lock = argv[++i];
    else if (a === '--write') args.write = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!args.report) args.report = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.report) throw new Error('missing <report.txt>');
  if (args.write && !args.lock) throw new Error('--write needs --lock <platform.lock>');
  return args;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err.write(`baseline-deviations: ${e.message}\n`);
    err.write('Usage: node scripts/baseline-deviations.mjs <report.txt> [--migrations <dir>] [--lock <platform.lock> --write]\n');
    return 2;
  }
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const migrationsDir = resolve(args.migrations ?? join(apiDir, 'prisma', 'migrations'));
  const report = readFileSync(args.report, 'utf8');
  const statements = parseBlockingStatements(report);
  const appOnly = parseAppOnlyDirectories(report);
  if (appOnly.length === 0) {
    err.write('baseline-deviations: the report lists no "app-only:" directories; save the output of a dry run (db:baseline -- --through 2)\n');
    return 2;
  }
  if (statements.length === 0) {
    err.write('baseline-deviations: the report has no BLOCKING statements; nothing to declare\n');
    return 2;
  }
  const appObjects = collectAppObjects(readMigrations(migrationsDir, appOnly));
  const { entries, refused } = classify(statements, appObjects);

  if (refused.length > 0) {
    err.write(`baseline-deviations: REFUSED ${refused.length} statement(s). They are real differences between the database and the platform history; do not declare them. Report them on the issue.\n`);
    for (const r of refused) err.write(`  - ${r.why}\n      ${r.statement}\n`);
    return 1;
  }

  const deviations = buildDeviations(entries);
  const counts = deviations.map((d) => `${d.id}: ${d.expectDiff.length}`).join(', ');
  err.write(`baseline-deviations: ${statements.length} statement(s) proven (${counts})\n`);

  if (args.write) {
    const { parseLock, serializeLock } = require('@marinoscar/platform-db');
    const lockFile = resolve(args.lock);
    const lock = parseLock(readFileSync(lockFile, 'utf8'), lockFile);
    const ids = new Set(deviations.map((d) => d.id));
    lock.deviations = [...(lock.deviations ?? []).filter((d) => !ids.has(d.id)), ...deviations];
    writeFileSync(lockFile, serializeLock(lock));
    err.write(`baseline-deviations: wrote ${deviations.length} deviation(s) to ${lockFile}\n`);
  } else {
    out.write(`${JSON.stringify(deviations, null, 2)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
