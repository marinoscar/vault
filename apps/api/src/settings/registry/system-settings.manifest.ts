// =============================================================================
// The system settings manifest (issue #79, E4.1)
// =============================================================================
//
// Which `system_settings` namespaces this deployment has, in stored key order
// (append, never insert): the platform's `maintenance`, then Vault's `ui`,
// `features`, `ai`, `vaultCards`, `vaultBackups` (`app-registrations/settings.ts`).
//
// The other platform namespaces (`jobs`, `nodes`, `notifications`, `storage`,
// `databaseBackup`, ...) are registered by the slice that owns them when it is
// adopted (E5 to E9): a slice's `forRoot()` registers its own through
// `ensureSystemSettingsNamespaces`, and a key listed here first is left alone.
// =============================================================================

import { MAINTENANCE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/host';
import { NOTIFICATIONS_SYSTEM_SETTINGS } from '@marinoscar/platform-api/notifications';
import {
  assembleSystemSettingsNamespaces,
  registerSystemSettingsNamespaces,
  type SystemSettingsNamespace,
} from '@marinoscar/platform-api/settings';

import {
  APP_SYSTEM_SETTINGS_EXTENSIONS,
  APP_SYSTEM_SETTINGS_NAMESPACES,
} from '../../app-registrations/settings';

export const PLATFORM_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [
  MAINTENANCE_SYSTEM_SETTINGS as SystemSettingsNamespace,
  NOTIFICATIONS_SYSTEM_SETTINGS as SystemSettingsNamespace, // E7.1: policy + org layer
];

export function assembleVaultSystemSettingsNamespaces(): SystemSettingsNamespace[] {
  return assembleSystemSettingsNamespaces({
    platform: PLATFORM_SYSTEM_SETTINGS_NAMESPACES,
    app: APP_SYSTEM_SETTINGS_NAMESPACES,
    appExtensions: APP_SYSTEM_SETTINGS_EXTENSIONS,
  });
}

let registered = false;

/** Idempotent per process: registering a namespace twice is `DUPLICATE_ID`. */
export function registerVaultSystemSettings(): void {
  if (registered) return;
  registered = true;
  registerSystemSettingsNamespaces(assembleVaultSystemSettingsNamespaces());
}
