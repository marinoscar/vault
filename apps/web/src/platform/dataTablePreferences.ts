/**
 * Where the platform `DataTable` keeps a user's per-table layout (visible
 * columns, density, sort, page size).
 *
 * The platform's default port stores it in the `dataTables` namespace of
 * `/api/user-settings`, which Vault's API does not accept yet (its schema is
 * `theme` + `profile` and strips unknown keys). Until the settings slice is
 * adopted (E4), the layout is a per-browser convenience in `localStorage`,
 * falling back to memory when storage is missing or blocked. It holds layout
 * only, never a secret value (list rows are not decrypted). Recorded in
 * docs/platform-adoption/local-exceptions.md.
 */

import type {
  DataTablePreferencesPort,
  DataTableStoredLayout,
} from '@marinoscar/platform-web/datatable/headless';

// PLATFORM-ADOPTION-SHIM(E4): table layouts in localStorage until /user-settings carries `dataTables`.
export const DATA_TABLE_PREFERENCES_STORAGE_KEY = 'vault.datatable.preferences';

function readStore(key: string, memory: Map<string, string>): Record<string, unknown> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = memory.get(key) ?? null;
  }
  if (raw === null) raw = memory.get(key) ?? null;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeStore(key: string, value: Record<string, unknown>, memory: Map<string, string>) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Blocked or full storage: the in-memory copy keeps this session working.
  }
}

/**
 * A `DataTablePreferencesPort` over `localStorage`. The table sanitizes every
 * entry it loads (`sanitizeStoredLayout`), so a corrupt store degrades to the
 * defaults rather than throwing.
 */
export function createLocalStorageDataTablePreferencesPort(
  key: string = DATA_TABLE_PREFERENCES_STORAGE_KEY,
): DataTablePreferencesPort {
  const memory = new Map<string, string>();
  return {
    async load() {
      return readStore(key, memory);
    },
    async save(tableId: string, entry: DataTableStoredLayout | null) {
      const all = readStore(key, memory);
      if (entry === null) delete all[tableId];
      else all[tableId] = entry;
      writeStore(key, all, memory);
    },
  };
}

export const dataTablePreferencesPort = createLocalStorageDataTablePreferencesPort();
