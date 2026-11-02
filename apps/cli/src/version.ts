import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The CLI version, read at runtime from `apps/cli/package.json`, the only place
 * it lives. `src/version.ts` and `dist/version.js` both sit one directory below
 * the package root, so `../package.json` resolves in tsx, vitest and the build.
 */
export function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const parsed: unknown = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    // An unusual install is not a reason to refuse to run.
  }
  return '0.0.0-unknown';
}
