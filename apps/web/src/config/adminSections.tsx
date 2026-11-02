/**
 * The admin settings registry (`ADMIN_SECTIONS`): the cards of the Console hub
 * at `/admin/settings` and what the rail lists in Console mode (any `/admin`
 * route at desktop width). Spec: docs/specs/ux-refresh.md §6.
 *
 * E10.2 (#93) seeded it with two cards; E10.3 (#94) split the tab-based
 * `SystemSettingsPage` into one routed page per card: the first card became
 * `General` (UI settings and feature flags, was the whole tab strip), Users
 * moved under the hub, and the rest were APPENDED. E3.3 (#78) replaced the
 * Users card in place with the packaged identity card (cards ship as data). Rules (AGENTS.md, Settings
 * UI Pattern):
 *
 *  - append, never insert between existing cards;
 *  - each card's `permission` is the exact string the API controller enforces
 *    on the page's read, and the route in `App.tsx` gates on the same string;
 *    writes are gated INSIDE the page by disabling controls;
 *  - an AI card declares `feature: 'ai'`, except the card that switches AI on
 *    (`AI`, below), which carries none so an admin can always turn it back on.
 *
 * Asserted by `__tests__/config/settingsRegistry.test.ts`.
 */

import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
import { identityAdminSections } from '@marinoscar/platform-web/identity/ui';
// Telemetry (E9.2, #90): the platform's three Observability cards, declared by the package (data
// only). Each carries the exact permission the telemetry controllers enforce (`telemetry:read` for
// the settings page, `telemetry:query` for the Explorer and Dashboard); the last two carry
// `feature: 'telemetry'` (a store is deployed and collection is on).
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';
import './settingsFeatures';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import AiIcon from '@mui/icons-material/AutoAwesomeOutlined';
import BackupIcon from '@mui/icons-material/BackupOutlined';
import MaintenanceIcon from '@mui/icons-material/ConstructionOutlined';
import AboutIcon from '@mui/icons-material/InfoOutlined';

/** The Console hub's title: the hub's heading and the compact AppBar's fallback. */
export const ADMIN_HUB_TITLE = 'Console';

/** The Console hub's route. */
export const ADMIN_HUB_PATH = '/admin/settings';

export const ADMIN_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Administration',
    cards: [
      {
        title: 'General',
        description: 'Interface options and feature flags.',
        Icon: TuneIcon,
        path: '/admin/settings/general',
        // system-settings.controller.ts `GET /api/system-settings`; saving needs system_settings:write.
        permission: 'system_settings:read',
      },
      // The packaged identity card (E3.3, #78), spread where Vault's own
      // `Users & allowlist` card was: `Users & Allowlist`, `/admin/settings/users`,
      // `users:read` (the platform's users.controller.ts `GET /api/users`; the
      // Allowlist tab gates itself on allowlist:read inside the page). The
      // `organizations` cards are not spread: Vault runs single-organization
      // (they carry `feature: 'orgs'` and would never show).
      ...identityAdminSections.access,
      {
        title: 'AI',
        description: 'Switch card scanning on, the OpenAI key, model and daily budget.',
        Icon: AiIcon,
        path: '/admin/settings/ai',
        // system-settings.controller.ts (the `ai` namespace); verify (ai-verify.controller.ts)
        // and saving need system_settings:write. The card that SWITCHES AI ON: no `feature`.
        permission: 'system_settings:read',
      },
      {
        title: 'Backups',
        description: 'Scheduled encrypted backups: schedule, contents, retention, run now and download.',
        Icon: BackupIcon,
        path: '/admin/settings/backups',
        // backups.controller.ts `GET /api/admin/backups/schedule` and the run list;
        // run, export, delete and save need system_settings:write.
        permission: 'system_settings:read',
      },
    ],
  },
  {
    label: 'Operations',
    cards: [
      {
        title: 'Maintenance',
        description: 'Take Vault offline for everyone but administrators, with a message.',
        Icon: MaintenanceIcon,
        path: '/admin/settings/maintenance',
        // The platform maintenance controller `GET /api/admin/maintenance` (default
        // permission SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ); PUT needs system_settings:write.
        permission: 'system_settings:read',
      },
      {
        // The packaged page's descriptor: title, description, path and permission
        // (`system_settings:read`, DoctorModule's default, bound in apps/api/src/doctor/doctor.config.ts).
        ...doctorSettingsPage.card,
        Icon: doctorSettingsPage.Icon,
      },
      {
        title: 'About',
        description: 'Which version is running, when it started, and what it runs on.',
        Icon: AboutIcon,
        path: '/admin/settings/about',
        // The platform about controller `GET /api/admin/about` (default permission
        // system_settings:read; deliberately no `about:read`).
        permission: 'system_settings:read',
      },
    ],
  },
  // E9.2 (#90). A NEW section APPENDED after Operations, so no existing card moves. `Telemetry`
  // (`telemetry:read`) has no `feature`: it is where collection is switched on, so it must be
  // reachable while the feature is off. The Explorer and Dashboard (`telemetry:query`) exist only
  // while a store is deployed and collection is on. Only the admin role holds `telemetry:*`.
  {
    label: 'Observability',
    cards: [...telemetryAdminCards],
  },
];
