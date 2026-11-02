/**
 * Where the packaged `DataTable` keeps each table's layout (visible columns,
 * density, sort, page size).
 *
 * The platform's default port stores it in the `dataTables` namespace of
 * `/api/user-settings`, which Vault's API does not accept yet (its schema is
 * `theme` + `profile` and strips unknown keys). Until the settings slice is
 * adopted (E4), the layouts are a per-browser convenience in `localStorage`,
 * read and written defensively: a missing, blocked or corrupt store leaves the
 * table with session-only preferences, never an error. The table sanitises
 * what it loads (`sanitizeStoredLayout`), so a hand-edited entry is harmless.
 * Recorded in docs/platform-adoption/local-exceptions.md.
 */

import type { DataTablePreferencesPort } from '@marinoscar/platform-web/datatable/headless';

// PLATFORM-ADOPTION-SHIM(E4): table layouts in localStorage until /user-settings carries `dataTables`.
export const DATA_TABLE_PREFERENCES_STORAGE_KEY = 'vault.dataTables';

function readAll(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(DATA_TABLE_PREFERENCES_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A module constant: the provider keys on the port's identity. */
export const dataTablePreferencesPort: DataTablePreferencesPort = Object.freeze({
  load: async () => readAll(),
  save: async (tableId: string, entry: unknown) => {
    try {
      const next = { ...readAll() };
      if (entry === null) delete next[tableId];
      else next[tableId] = entry;
      window.localStorage.setItem(DATA_TABLE_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the layout lasts for the session only.
    }
  },
});
