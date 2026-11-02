// =============================================================================
// Settings registry entry point (issue #79, E4.1)
// =============================================================================
//
// IMPORTING THIS FILE REGISTERS EVERY SETTINGS NAMESPACE. The platform's request
// bodies and OpenAPI document are composed FROM THE REGISTRIES when
// `SettingsModule.forRoot()` runs, so `platform/settings/settings.config.ts`, the
// test setup and the scripts reach this file first.
// =============================================================================

import { registerVaultSystemSettings } from './system-settings.manifest';
import { registerVaultUserSettings } from './user-settings.manifest';

registerVaultSystemSettings();
registerVaultUserSettings();

export { assembleVaultSystemSettingsNamespaces } from './system-settings.manifest';
export { assembleVaultUserSettingsNamespaces } from './user-settings.manifest';
