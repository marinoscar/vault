/**
 * The admin settings registry (`ADMIN_SECTIONS`): what the rail lists in
 * Console mode (any `/admin` route at desktop width) and, from E10.3, the cards
 * of the `/admin/settings` hub (spec: docs/specs/ux-refresh.md §6).
 *
 * E10.2 (issue #93) seeds it with the two admin pages that exist today, so the
 * Console has its rows; E10.3 splits `SystemSettingsPage` into one card per
 * page and APPENDS them here. Rules (AGENTS.md, Settings UI Pattern): append,
 * never insert; each card's `permission` is the exact string the API
 * controller enforces.
 */

import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import PeopleIcon from '@mui/icons-material/PeopleOutlined';

export const ADMIN_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Administration',
    cards: [
      {
        title: 'System settings',
        description: 'General, feature flags, AI and scheduled backups.',
        Icon: TuneIcon,
        path: '/admin/settings',
        // system-settings.controller.ts `GET /api/system-settings`
        permission: 'system_settings:read',
      },
      {
        title: 'Users & allowlist',
        description: 'Who can sign in, and their roles.',
        Icon: PeopleIcon,
        path: '/admin/users',
        // users.controller.ts `GET /api/users`; the allowlist half gates itself on allowlist:read.
        permission: 'users:read',
      },
    ],
  },
];
