// =============================================================================
// The settings slice's composition (issue #79, E4.1, epic #54)
// =============================================================================
//
// `SettingsModule.forRoot` serves `GET|PUT|PATCH /api/system-settings`,
// `/api/user-settings` and `/api/org-settings`, and provides
// `SystemSettingsService`, `UserSettingsService`, `SettingsResolver` and
// `SystemSettingsRowStore` globally. It replaces Vault's own settings module and
// the E3 `SystemSettingsShim`.
//
// IT MUST RUN AFTER THE NAMESPACE MANIFESTS: the request bodies and the OpenAPI
// document are composed from the registries when `forRoot` runs, so the import
// below comes first. `systemRowKey` is `'global'`, the row Vault has always used;
// `orgLayer` is `'auto'` (single-organization mode: an org row never exists).
// =============================================================================

import { SettingsModule } from '@marinoscar/platform-api/settings';

import '../../settings/registry';
import { SettingsHostModule } from './settings-host.module';

export const settingsModule = SettingsModule.forRoot({
  systemRowKey: 'global',
  orgLayer: 'auto',
  imports: [SettingsHostModule],
});
