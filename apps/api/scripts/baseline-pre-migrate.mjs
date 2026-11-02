#!/usr/bin/env node
/**
 * baseline-pre-migrate.mjs - the baseline gate to run BEFORE `prisma:migrate`.
 *
 *   npm run db:baseline:pre-migrate [-- <extra platform db baseline args>]
 *
 * Runs `platform db baseline --through 2 --allow-rls <extra args>` against a
 * database that has not taken the app migrations yet.
 *
 * Why not plain `npm run db:baseline -- --through 2 --allow-rls`: platform.lock
 * lists `rlsPolicies` (media_folder_files_org_isolation, created by the app
 * migration 20261103090000_attachments_composite_fk_media_rls, E6.2). The
 * baseline asserts that EVERY listed policy exists in the database, so on a
 * pre-migration database it refuses with POLICY_MISSING / RLS_NOT_ENABLED. A
 * deviation cannot declare a policy, and `db:drift` needs the listing after the
 * migration, so the listing stays in the lock and the gate ignores it.
 *
 * How: the command is pointed (`--root`) at a TEMPORARY app root whose
 * prisma/platform.lock is a copy WITHOUT `rlsPolicies`; every other entry of
 * apps/api and of prisma/ is a symlink to the real one. The real
 * prisma/platform.lock is never opened for writing while the gate runs, so a
 * crash cannot leave it stripped.
 *
 * `--apply` (rehearsals only; production does not run it, the lock ships in the
 * image) rewrites the lock it was given, i.e. the temporary copy. When the run
 * succeeds and changed that copy, the new lock is written back to the real
 * prisma/platform.lock with the original `rlsPolicies` merged in again.
 *
 * Exit code: the command's.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realLockPath = join(apiDir, 'prisma', 'platform.lock');
const realLockText = readFileSync(realLockPath, 'utf8');
const realLock = JSON.parse(realLockText);

const stripped = { ...realLock };
delete stripped.rlsPolicies;
const strippedText = JSON.stringify(stripped, null, 2) + '\n';

// Inside apps/api (removed in `finally`) so `npx prisma` still resolves the hoisted node_modules.
const TMP_PREFIX = '.baseline-pre-migrate-';
const tmpRoot = mkdtempSync(join(apiDir, TMP_PREFIX));
let code = 1;
try {
  for (const entry of readdirSync(apiDir)) {
    if (entry !== 'prisma' && !entry.startsWith(TMP_PREFIX)) symlinkSync(join(apiDir, entry), join(tmpRoot, entry));
  }
  mkdirSync(join(tmpRoot, 'prisma'));
  for (const entry of readdirSync(join(apiDir, 'prisma'))) {
    if (entry !== 'platform.lock') symlinkSync(join(apiDir, 'prisma', entry), join(tmpRoot, 'prisma', entry));
  }
  const tmpLockPath = join(tmpRoot, 'prisma', 'platform.lock');
  writeFileSync(tmpLockPath, strippedText);

  const args = [
    join(apiDir, 'scripts', 'platform-env.js'),
    'db', 'baseline',
    '--through', '2', '--allow-rls',
    '--root', tmpRoot,
    '--prisma-script', join(apiDir, 'scripts', 'prisma-env.js'),
    ...process.argv.slice(2),
  ];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: apiDir });
  code = result.status ?? 1;

  if (code === 0 && existsSync(tmpLockPath)) {
    const after = readFileSync(tmpLockPath, 'utf8');
    if (after !== strippedText) {
      const merged = { ...JSON.parse(after), ...(realLock.rlsPolicies ? { rlsPolicies: realLock.rlsPolicies } : {}) };
      const keys = Object.keys(merged).sort();
      writeFileSync(realLockPath, JSON.stringify(Object.fromEntries(keys.map((k) => [k, merged[k]])), null, 2) + '\n');
      console.error('baseline-pre-migrate: platform.lock was rewritten by --apply; rlsPolicies merged back.');
    }
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(code);
