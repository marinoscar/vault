// The API's permission strings, read from the declarations themselves, for the platform web
// conformance entry (../conformance.test.tsx). settingsRegistry.test.ts holds the same set with the
// controller mirror; both read the same files.
// The API's permission catalog (E3.2): roles.constants.ts DERIVES `PERMISSIONS` from
// the platform slices Vault seeds (apps/api/src/platform/permissions.ts) plus
// Vault's own (`VAULT_PERMISSIONS`, in @marinoscar/vault-api since E12.2). Read the declarations themselves.
import vaultPermissionsSource from '../../../../../packages/vault-api/src/core/permissions.ts?raw';
import settingsPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/settings/settings.permissions.js?raw';
import usersPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/identity/users/users.permissions.js?raw';
import allowlistPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/identity/allowlist/allowlist.permissions.js?raw';
import dbBackupPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/db-backup/db-backup.permissions.js?raw';
import notificationsPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/notifications/notifications.permissions.js?raw';
import userDataPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/user-data/user-data.permissions.js?raw';
import aiPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/ai/ai.permissions.js?raw';
import telemetryPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/telemetry/telemetry.permissions.js?raw';
import storageConfigPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/storage/config/storage-config.permissions.js?raw';


/** The `id: '<resource>:<action>'` strings a permission declaration file declares. */
const declaredIds = (source: string): string[] =>
  [...source.matchAll(/\bid:\s*'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);

/**
 * Every permission string the API declares and seeds: Vault's own
 * (`VAULT_PERMISSIONS`) plus the platform `identity` (users, allowlist) and
 * `settings` slices, the `notifications` slice (`broadcasts:*`, `push:*`, E7)
 * and the `ai` slice (`ai_config:*`, `ai:use`, E8), which `PERMISSION_OPTIONS` lists (asserted below, so a slice Vault stops
 * seeding drops its strings from this set).
 */
export const API_PERMISSIONS = new Set([
  ...declaredIds(vaultPermissionsSource),
  ...declaredIds(settingsPermissionsSource),
  ...declaredIds(usersPermissionsSource),
  ...declaredIds(allowlistPermissionsSource),
  ...declaredIds(notificationsPermissionsSource),
  ...declaredIds(dbBackupPermissionsSource),
  ...declaredIds(aiPermissionsSource),
  ...declaredIds(telemetryPermissionsSource),
  ...declaredIds(storageConfigPermissionsSource),
  // E9.3 (#91): `system:factory_reset` and `orgs:offboard` (the user-data slice, Admin only).
  ...declaredIds(userDataPermissionsSource),
]);

