// =============================================================================
// No timer-driven work outside the queue (issue #83, E5.3)
// =============================================================================
//
// The platform's `cron-enqueue-only` suite reads `@Cron` bodies only. A `@Interval`
// or `@Timeout` decorator, or a bare `setInterval`, is the same violation by another
// spelling: work that runs on a timer in whichever process holds it, invisible in the
// Jobs list. Vault has none left (E5.2 deleted the backup runner's in-run heartbeat).
// In-memory bookkeeping (the AI burst limiter) prunes lazily instead of on a timer.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { VAULT_SOURCE_ROOTS } from './cron-source-roots';

/** Files allowed a timer, with the reason; each must still contain one. */
const TIMER_EXEMPTIONS: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const TIMER = /@Interval\(|@Timeout\(|\bsetInterval\(/;

const withTimers = VAULT_SOURCE_ROOTS.flatMap((root) => sourceFiles(root).map((path) => ({ root, path })))
  .map(({ root, path }) => ({ rel: relative(root, path).split('\\').join('/'), source: code(readFileSync(path, 'utf8')) }))
  .filter((file) => TIMER.test(file.source))
  .map((file) => file.rel);

describe('no timer-driven work outside the queue', () => {
  it('no source file holds a timer except the listed exemptions (none)', () => {
    expect(withTimers.filter((file) => !(file in TIMER_EXEMPTIONS))).toEqual([]);
  });
});
