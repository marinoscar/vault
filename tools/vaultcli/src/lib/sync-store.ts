import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../utils/config.js';
import type {
  SyncRegistry,
  SyncEntry,
  SyncFileEntry,
  SyncDirEntry,
} from '../utils/types.js';

function getSyncFile(): string {
  return join(config.configDir, 'sync.json');
}

export function getSyncFilePath(): string {
  return getSyncFile();
}

export function loadRegistry(): SyncRegistry {
  try {
    const file = getSyncFile();
    if (!existsSync(file)) return { entries: [] };
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as SyncRegistry;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

export function saveRegistry(reg: SyncRegistry): void {
  const file = getSyncFile();
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify(reg, null, 2), { mode: 0o600 });
}

export function addFileEntry(entry: SyncFileEntry): void {
  const reg = loadRegistry();
  const dup = reg.entries.some(
    (e) => e.kind === 'file' && e.name === entry.name,
  );
  if (dup) {
    throw new Error(`A synced file named "${entry.name}" already exists`);
  }
  reg.entries.push(entry);
  saveRegistry(reg);
}

export function addDirEntry(entry: SyncDirEntry): void {
  const reg = loadRegistry();
  const dup = reg.entries.some(
    (e) => e.kind === 'dir' && e.path === entry.path,
  );
  if (dup) {
    throw new Error(`A synced directory for "${entry.path}" already exists`);
  }
  reg.entries.push(entry);
  saveRegistry(reg);
}

/**
 * Remove an entry by file name or by path (file or directory).
 * Returns the removed entry, or null if nothing matched.
 */
export function removeEntry(key: string): SyncEntry | null {
  const reg = loadRegistry();
  const idx = reg.entries.findIndex(
    (e) => e.path === key || (e.kind === 'file' && e.name === key),
  );
  if (idx === -1) return null;
  const [removed] = reg.entries.splice(idx, 1);
  saveRegistry(reg);
  return removed;
}
