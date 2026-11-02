// =============================================================================
// The user settings manifest (issue #79, E4.1)
// =============================================================================
//
// Optional `user_settings` namespaces, in stored key order (append, never
// insert): the platform's `dataTables` and `navigation`. They give the web's
// localStorage shell and datatable preference shims
// (PLATFORM-ADOPTION-SHIM(E4)) a server-side home; the web move is a follow-up.
// `theme` and `profile` are core fields the platform composes ahead of these.
// =============================================================================

import {
  DATA_TABLES_USER_SETTINGS,
  NAVIGATION_USER_SETTINGS,
  assembleUserSettingsNamespaces,
  registerUserSettingsNamespaces,
  type UserSettingsNamespace,
} from '@marinoscar/platform-api/settings';

import { APP_USER_SETTINGS_NAMESPACES } from '../../app-registrations/settings';

export const PLATFORM_USER_SETTINGS_NAMESPACES: readonly UserSettingsNamespace[] = [
  DATA_TABLES_USER_SETTINGS as UserSettingsNamespace,
  NAVIGATION_USER_SETTINGS as UserSettingsNamespace,
];

export function assembleVaultUserSettingsNamespaces(): UserSettingsNamespace[] {
  return assembleUserSettingsNamespaces({
    platform: PLATFORM_USER_SETTINGS_NAMESPACES,
    app: APP_USER_SETTINGS_NAMESPACES,
  });
}

let registered = false;

export function registerVaultUserSettings(): void {
  if (registered) return;
  registered = true;
  registerUserSettingsNamespaces(assembleVaultUserSettingsNamespaces());
}
