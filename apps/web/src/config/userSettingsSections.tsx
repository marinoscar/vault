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
import PersonIcon from '@mui/icons-material/PersonOutlined';
import PaletteIcon from '@mui/icons-material/PaletteOutlined';
import TokenIcon from '@mui/icons-material/VpnKeyOutlined';
import BackupIcon from '@mui/icons-material/BackupOutlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';

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
      {
        title: 'Access tokens',
        description: 'Personal access tokens for the CLI and scripts.',
        Icon: TokenIcon,
        path: '/settings/tokens',
        // pat.controller.ts: bare `@Auth()`, ownership-scoped. No permission.
      },
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
    ],
  },
];
