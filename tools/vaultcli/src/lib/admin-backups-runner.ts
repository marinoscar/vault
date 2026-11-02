/**
 * I/O side of admin backups, shared by `vaultcli admin backups ...` and the
 * "Admin backups" menu: API error mapping, waiting for a run, and streaming a
 * download to disk (`.partial`, mode 0600, renamed when complete).
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { chmod } from 'fs/promises';
import { homedir } from 'os';
import { dirname, resolve as resolvePath } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { config } from '../utils/config.js';
import { ApiStatusError, findAdminBackupRun, getAdminBackupDownload } from './api-client.js';
import { commitPartial } from './backup-runner.js';
import {
  RUN_POLL_INTERVAL_MS,
  adminBackupErrorMessage,
  downloadTarget,
  isRunSettled,
  type AdminBackupRun,
} from './admin-backups.js';

/** Re-throw an API failure with the admin-facing message (403, 409, 404). */
export function toAdminError(err: unknown, op?: 'run' | 'delete' | 'download'): Error {
  if (err instanceof ApiStatusError) return new Error(adminBackupErrorMessage(err.status, err.message, op));
  return err instanceof Error ? err : new Error(String(err));
}

export async function adminCall<T>(fn: () => Promise<T>, op?: 'run' | 'delete' | 'download'): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAdminError(err, op);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll a run until it is no longer `running`. `onTick` gets every observed
 * state (including the first). Throws if the run disappears from the list.
 */
export async function waitForRun(
  id: string,
  hooks: { onTick?: (run: AdminBackupRun, elapsedMs: number) => void; intervalMs?: number } = {},
): Promise<AdminBackupRun> {
  const started = Date.now();
  const interval = hooks.intervalMs ?? RUN_POLL_INTERVAL_MS;
  for (;;) {
    const run = await adminCall(() => findAdminBackupRun(id));
    if (!run) throw new Error(`Backup run ${id} is no longer in the history`);
    hooks.onTick?.(run, Date.now() - started);
    if (isRunSettled(run)) return run;
    await sleep(interval);
  }
}

export interface AdminDownloadResult {
  id: string;
  path: string;
  size: number;
  fileName: string;
  overwritten: boolean;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get a signed URL for the run and stream it to disk. The bearer token is
 * never sent to the signed URL (it points at object storage).
 */
export async function downloadAdminBackup(input: {
  id: string;
  output?: string;
  overwrite: boolean;
  progress?: (message: string) => void;
}): Promise<AdminDownloadResult> {
  const link = await adminCall(() => getAdminBackupDownload(input.id), 'download');
  const target = downloadTarget({
    output: input.output,
    fileName: link.fileName,
    cwd: process.cwd(),
    homeDir: homedir(),
    isDirectory,
    resolve: resolvePath,
  });
  if (isDirectory(target)) throw new Error(`Output path ${target} is a directory`);
  mkdirSync(dirname(target), { recursive: true });

  // A relative URL (a local storage provider) is resolved against the server.
  const url = /^https?:\/\//i.test(link.url) ? link.url : new URL(link.url, config.serverUrl + '/').toString();
  input.progress?.(`Downloading ${link.fileName}...`);
  const res = await fetch(url);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Download failed: storage answered HTTP ${res.status}${res.status === 403 ? ' (the link may have expired; try again)' : ''}`);
  }
  if (!res.body) throw new Error('Download failed: empty response body');

  const partial = `${target}.partial`;
  let partialCreated = false;
  const cleanup = (): void => {
    if (partialCreated) {
      try {
        if (existsSync(partial)) unlinkSync(partial);
      } catch {
        // ignore
      }
    }
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    process.stderr.write(`Download interrupted (${signal}); partial file removed\n`);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const ws = createWriteStream(partial, { flags: 'w', mode: 0o600 });
    partialCreated = true;
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>), ws);
    await chmod(partial, 0o600);
    const size = statSync(partial).size;
    if (size === 0) throw new Error('storage returned an empty file');
    const existed = existsSync(target);
    const path = await commitPartial(partial, target, input.overwrite);
    partialCreated = false;
    return { id: input.id, path, size, fileName: link.fileName, overwritten: input.overwrite && existed };
  } catch (err) {
    cleanup();
    let message = err instanceof Error ? err.message : String(err);
    if (message === 'terminated' || (err as NodeJS.ErrnoException)?.code === 'ECONNRESET') {
      message = 'the connection closed before the download finished';
    }
    throw new Error(message.startsWith('Download failed') ? message : `Download failed (partial file removed): ${message}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
