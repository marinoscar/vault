import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join, relative, resolve, sep } from 'path';
import {
  getSecret,
  getSecretByName,
  createSecret,
  updateSecret,
  uploadStorageObject,
  linkAttachment,
  listAttachments,
  deleteAttachment,
  findDocumentTypeId,
} from './api-client.js';
import { saveRegistry } from './sync-store.js';
import type {
  Secret,
  SyncDirEntry,
  SyncFileEntry,
  SyncRegistry,
  SyncResult,
  SyncRunSummary,
} from '../utils/types.js';

export interface SyncContext {
  dryRun?: boolean;
  warn?: (msg: string) => void;
  /** Cached per-run Document type id (do not set manually). */
  documentTypeId?: string;
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function resolveAbs(p: string): string {
  return resolve(p);
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes('404');
}

function attachmentLabel(version: number): string {
  return `v${version} ${new Date().toISOString().slice(0, 10)}`;
}

async function getDocTypeId(ctx: SyncContext): Promise<string> {
  if (!ctx.documentTypeId) {
    ctx.documentTypeId = await findDocumentTypeId();
  }
  return ctx.documentTypeId;
}

// ---------------------------------------------------------------------------
// Folder discovery
// ---------------------------------------------------------------------------

function patternToRegExp(pattern: string): RegExp {
  // Escape regex metacharacters except the glob wildcards * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`);
}

function discoverFiles(dir: string, pattern: string, recursive: boolean): string[] {
  const re = patternToRegExp(pattern);
  const skip = new Set(['.git', 'node_modules']);
  const out: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > 10) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(current, ent.name);
      if (ent.isDirectory()) {
        if (recursive && !skip.has(ent.name)) walk(full, depth + 1);
      } else if (ent.isFile() && re.test(ent.name)) {
        out.push(full);
      }
    }
  }

  walk(dir, 0);
  return out;
}

function deriveName(dir: string, file: string, namePrefix?: string): string {
  const prefix = namePrefix ?? basename(dir);
  const rel = relative(dir, file).split(sep).join('/');
  return `${prefix}/${rel}`;
}

// ---------------------------------------------------------------------------
// Single-file sync
// ---------------------------------------------------------------------------

async function resolveExistingSecret(entry: SyncFileEntry): Promise<Secret | null> {
  if (entry.secretId) {
    try {
      return await getSecret(entry.secretId);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  try {
    return await getSecretByName(entry.name);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function attachLatest(
  secretId: string,
  entry: SyncFileEntry,
  content: string,
  version: number,
  ctx: SyncContext,
  existingIds: string[],
): Promise<boolean> {
  try {
    const obj = await uploadStorageObject({
      content,
      filename: basename(entry.path),
      mimeType: 'text/plain',
    });
    await linkAttachment(secretId, {
      storageObjectId: obj.id,
      label: attachmentLabel(version),
    });
    // Link-new-before-delete-old so a copy always exists.
    for (const id of existingIds) {
      try {
        await deleteAttachment(secretId, id);
      } catch {
        /* best-effort cleanup */
      }
    }
    return true;
  } catch (err) {
    ctx.warn?.(
      `Attachment sync skipped for "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function syncOne(entry: SyncFileEntry, ctx: SyncContext): Promise<SyncResult> {
  const abs = resolveAbs(entry.path);
  if (!existsSync(abs)) {
    return { name: entry.name, path: entry.path, action: 'error', reason: 'missing-file' };
  }

  let content: string;
  try {
    content = readFileSync(abs, 'utf8');
  } catch (err) {
    return {
      name: entry.name,
      path: entry.path,
      action: 'error',
      reason: err instanceof Error ? err.message : 'read-failed',
    };
  }
  const localHash = sha256(content);

  let secret: Secret | null;
  try {
    secret = await resolveExistingSecret(entry);
  } catch (err) {
    return {
      name: entry.name,
      path: entry.path,
      action: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  // Determine the current vault hash (registry fast-path, then notes-derived).
  let currentHash: string | undefined = entry.lastSyncedHash;
  if (secret) {
    entry.secretId = secret.id;
    if (!currentHash) {
      const notes = secret.values?.notes;
      if (typeof notes === 'string') currentHash = sha256(notes);
    }
  }

  // CREATE
  if (!secret) {
    if (ctx.dryRun) {
      return { name: entry.name, path: entry.path, action: 'created' };
    }
    try {
      const typeId = await getDocTypeId(ctx);
      const created = await createSecret({
        name: entry.name,
        typeId,
        description: entry.description,
        data: { title: basename(entry.path), notes: content },
      });
      const version = created.currentVersion ?? 1;
      const attachmentSynced = await attachLatest(created.id, entry, content, version, ctx, []);
      entry.secretId = created.id;
      entry.lastSyncedHash = localHash;
      entry.lastVersion = version;
      entry.lastSyncedAt = new Date().toISOString();
      return { name: entry.name, path: entry.path, action: 'created', version, attachmentSynced };
    } catch (err) {
      return {
        name: entry.name,
        path: entry.path,
        action: 'error',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // UNCHANGED
  if (currentHash === localHash) {
    if (!ctx.dryRun) {
      entry.lastSyncedHash = localHash;
      entry.lastVersion = secret.currentVersion ?? entry.lastVersion;
      entry.lastSyncedAt = new Date().toISOString();
    }
    return {
      name: entry.name,
      path: entry.path,
      action: 'unchanged',
      version: secret.currentVersion ?? undefined,
    };
  }

  // UPDATE
  if (ctx.dryRun) {
    return {
      name: entry.name,
      path: entry.path,
      action: 'updated',
      version: (secret.currentVersion ?? 0) + 1,
    };
  }
  try {
    let existingIds: string[] = [];
    try {
      existingIds = (await listAttachments(secret.id)).map((a) => a.id);
    } catch {
      /* tolerate; replace step is best-effort anyway */
    }
    const updated = await updateSecret(secret.id, {
      data: { title: basename(entry.path), notes: content },
    });
    const version = updated.currentVersion ?? (secret.currentVersion ?? 0) + 1;
    const attachmentSynced = await attachLatest(secret.id, entry, content, version, ctx, existingIds);
    entry.secretId = secret.id;
    entry.lastSyncedHash = localHash;
    entry.lastVersion = version;
    entry.lastSyncedAt = new Date().toISOString();
    return { name: entry.name, path: entry.path, action: 'updated', version, attachmentSynced };
  } catch (err) {
    return {
      name: entry.name,
      path: entry.path,
      action: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

interface WorkItem {
  entry: SyncFileEntry;
  /** Whether mutations to entry should be persisted (explicit entries only). */
  persist: boolean;
}

/**
 * Expand the registry into a concrete, deduped list of file entries.
 * Explicit file entries win over directory-discovered duplicates.
 */
function buildWorkList(registry: SyncRegistry): WorkItem[] {
  const fileEntries = registry.entries.filter(
    (e): e is SyncFileEntry => e.kind === 'file',
  );
  const dirEntries = registry.entries.filter(
    (e): e is SyncDirEntry => e.kind === 'dir',
  );

  const seen = new Set<string>();
  const work: WorkItem[] = [];

  for (const entry of fileEntries) {
    const abs = resolveAbs(entry.path);
    if (seen.has(abs)) continue;
    seen.add(abs);
    work.push({ entry, persist: true });
  }

  for (const dir of dirEntries) {
    const dirAbs = resolveAbs(dir.path);
    const files = discoverFiles(dirAbs, dir.pattern, dir.recursive);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      work.push({
        entry: {
          kind: 'file',
          name: deriveName(dirAbs, file, dir.namePrefix),
          path: file,
          description: dir.description,
        },
        persist: false,
      });
    }
  }

  return work;
}

export function summarize(results: SyncResult[]): SyncRunSummary {
  return {
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    errors: results.filter((r) => r.action === 'error').length,
  };
}

/**
 * Run the sync over the registry. Mutates explicit entries in place and
 * persists the registry once when any change was made (unless dryRun).
 */
export async function runSync(
  registry: SyncRegistry,
  ctx: SyncContext = {},
  filterName?: string,
): Promise<SyncResult[]> {
  const work = buildWorkList(registry).filter(
    (item) => !filterName || item.entry.name === filterName,
  );

  const results: SyncResult[] = [];
  let mutated = false;

  for (const item of work) {
    const result = await syncOne(item.entry, ctx);
    results.push(result);
    if (item.persist && result.action !== 'error') mutated = true;
  }

  if (mutated && !ctx.dryRun) {
    saveRegistry(registry);
  }

  return results;
}
