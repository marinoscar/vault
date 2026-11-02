/**
 * The per-user settings registry (`USER_SETTINGS_SECTIONS`): the cards of the
 * `/settings` hub (E10.3, issue #94; spec: docs/specs/ux-refresh.md §6). It
 * replaces the stacked `UserSettingsPage`: each card is its own routed page.
 *
 * Same rules as `adminSections.tsx`: append, never insert; a card's
 * `permission` is the exact string the API controller enforces (absent when
 * the controller is ownership-scoped with a bare `@Auth()`); AI cards declare
 * `feature: 'ai'` (Vault has no per-user AI card until E8).
 *
 * Asserted by `__tests__/config/settingsRegistry.test.ts`.
 */

import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { identityUserSettingsSections } from '@marinoscar/platform-web/identity/ui';
import PersonIcon from '@mui/icons-material/PersonOutlined';
import PaletteIcon from '@mui/icons-material/PaletteOutlined';
import BackupIcon from '@mui/icons-material/BackupOutlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import NotificationsIcon from '@mui/icons-material/NotificationsOutlined';
import { dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';
import { DANGER_ZONE_GROUP_LABEL } from '@marinoscar/platform-web/user-data/headless';
import { dangerZoneSettingsPage } from '@marinoscar/platform-web/user-data/ui';
import { gettingStartedSettingsPage } from '@marinoscar/platform-web/onboarding/ui';
// The feature resolvers (`ai`), registered before any hub reads them.
import './settingsFeatures';

/** The per-user hub's title. */
export const USER_HUB_TITLE = 'Settings';

/** The per-user hub's route. */
export const USER_HUB_PATH = '/settings';

export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Account',
    cards: [
      {
        title: 'Profile',
        description: 'Your display name and profile picture.',
        Icon: PersonIcon,
        path: '/settings/profile',
        // user-settings.controller.ts `GET /api/user-settings`; saving needs user_settings:write.
        permission: 'user_settings:read',
      },
      {
        title: 'Appearance',
        description: 'Light, dark, or follow the system.',
        Icon: PaletteIcon,
        path: '/settings/appearance',
        // user-settings.controller.ts `GET /api/user-settings` (the `theme` field).
        permission: 'user_settings:read',
      },
      // The packaged identity card (E3.3, #78), spread where Vault's own
      // `Access tokens` card was: `Access Tokens`, `/settings/tokens`, no
      // permission (the platform's pat.controller.ts: bare `@Auth()`, ownership-scoped).
      ...identityUserSettingsSections.security,
      // E9.3 (#91), APPENDED: the packaged Getting started page (`gettingStartedSettingsPage`):
      // the caller's own checklist from `GET /api/onboarding`, which needs only
      // `user_settings:read` (every role), so the card carries no permission.
      { ...gettingStartedSettingsPage.card, Icon: gettingStartedSettingsPage.Icon },
    ],
  },
  {
    label: 'Data',
    cards: [
      {
        title: 'My backups',
        description: 'Encrypted backups of your secrets: download one, or save it to storage.',
        Icon: BackupIcon,
        path: '/settings/backups',
        // my-backups.controller.ts (every route), and POST /api/secrets/export.
        permission: 'secrets:read',
      },
      {
        title: 'Secret types',
        description: 'The fields each kind of secret holds. System types are read-only; add your own.',
        Icon: CategoryIcon,
        path: '/settings/secret-types',
        // secret-types.controller.ts `GET /api/secret-types`; create/edit need
        // secret_types:write, delete secret_types:delete.
        permission: 'secret_types:read',
      },
      // E9.3 (#91), APPENDED: the packaged "Download your data" page. No permission: the API grants
      // the `user-data` and `vault-secrets` sources to every role through `user_settings:read`, and
      // lists only the sources the caller may use. It exports metadata only; secret values leave
      // through the password-protected zip on My backups (see VaultExportNotice).
      { ...dataExportSettingsPage.card, Icon: dataExportSettingsPage.Icon },
    ],
  },
  {
    // E7.2: APPENDED as a section of its own. The packaged
    // `UserNotificationsPage` (@marinoscar/platform-web/notifications/ui).
    label: 'Notifications',
    cards: [
      {
        title: 'Notifications',
        description: 'Choose which events notify you, and whether by email or in your browser.',
        Icon: NotificationsIcon,
        path: '/settings/notifications',
        // The page reads and saves the caller's `notifications` preferences in
        // user-settings.controller.ts (`GET /api/user-settings`, user_settings:read; saving
        // needs user_settings:write), like Profile and Appearance. The event and channel
        // registries it draws (`GET /api/notifications/events|channels`) are bare `@Auth()`.
        permission: 'user_settings:read',
      },
    ],
  },
  {
    // E9.3 (#91): the packaged Delete my data page, in its own group KEPT LAST of the registry
    // (`dangerZoneLastViolations`; the one documented exception to append-only). No permission:
    // every role holds `user_settings:write`, which the API enforces on `/api/user-data/*`.
    label: DANGER_ZONE_GROUP_LABEL,
    cards: [{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }],
  },
];
