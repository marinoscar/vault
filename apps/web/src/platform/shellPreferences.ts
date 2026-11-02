/**
 * Where the shell keeps the desktop rail's collapse preference.
 *
 * The platform's default stores it in the `navigation` namespace of
 * `/api/user-settings`, which Vault's API does not accept yet (its schema is
 * `theme` + `profile` and strips unknown keys). Until the settings slice is
 * adopted, the preference is a per-browser convenience in `localStorage`
 * through the platform's own port, which tolerates a missing or blocked store.
 * Recorded in docs/platform-adoption/local-exceptions.md.
 */

import { createLocalStorageShellPreferencesPort } from '@marinoscar/platform-web/shell/headless';

// PLATFORM-ADOPTION-SHIM(E4): rail preference in localStorage until /user-settings carries `navigation`.
export const SHELL_PREFERENCES_STORAGE_KEY = 'vault.shell.preferences';

export const shellPreferencesPort = createLocalStorageShellPreferencesPort(SHELL_PREFERENCES_STORAGE_KEY);
