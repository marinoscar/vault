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
import { dbBackupAdminSections } from '@marinoscar/platform-web/db-backup/ui';
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
import ModelsIcon from '@mui/icons-material/ModelTrainingOutlined';
import UsageIcon from '@mui/icons-material/QueryStatsOutlined';
import BackupIcon from '@mui/icons-material/BackupOutlined';
import MaintenanceIcon from '@mui/icons-material/ConstructionOutlined';
import AboutIcon from '@mui/icons-material/InfoOutlined';
import EmailIcon from '@mui/icons-material/EmailOutlined';
import PushIcon from '@mui/icons-material/NotificationsActiveOutlined';
import BroadcastIcon from '@mui/icons-material/CampaignOutlined';
import StorageIcon from '@mui/icons-material/CloudOutlined';

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
        description: 'Switch AI on, the OpenAI key, limits, and the model card scanning runs on.',
        Icon: AiIcon,
        path: '/admin/settings/ai',
        // E8.2 (#88): the packaged AiConfigPage. `ai_config:read` is the string the
        // platform's ai-admin.controller enforces on `GET /api/admin/ai/config`
        // (`ai_config:write` on every write, gated inside the page). Vault's
        // `Card scanning model` section on the page saves through system settings
        // (system_settings:write). The card that SWITCHES AI ON: no `feature`.
        permission: 'ai_config:read',
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
      {
        // E8.2 (#88), APPENDED last in Administration. The packaged AiModelsPage,
        // beneath the AI route at the path the platform's pages link to.
        // `ai_config:read` is what ai-admin.controller enforces on
        // `GET /api/admin/ai/models` (enabling a model, refreshing the catalogue and
        // editing its limits need ai_config:write, gated inside the page).
        // `feature: 'ai'`: hidden while AI is off (the AI card switches it on).
        title: 'AI models',
        description: 'The model catalogue: what each model can do, which ones may be used, and their limits.',
        Icon: ModelsIcon,
        path: '/admin/settings/ai/models',
        permission: 'ai_config:read',
        feature: 'ai',
      },
      {
        // E8.2 (#88). The packaged AiUsagePage; `ai_config:read` is what
        // ai-usage-admin.controller enforces on `GET /api/admin/ai/usage`.
        title: 'AI usage',
        description: 'Calls and tokens across the deployment, by user, model, provider or feature (card scanning).',
        Icon: UsageIcon,
        path: '/admin/settings/ai/usage',
        permission: 'ai_config:read',
        feature: 'ai',
      },
      {
        // E6.1 web follow-up (#84), APPENDED last in Administration. The packaged
        // StorageConfigPage (`@marinoscar/platform-web/storage/ui`). Since E6.1 the
        // bucket and its key are runtime configuration, never environment variables.
        // `storage_config:read` is the exact string the platform's
        // storage-config.controller enforces on `GET /api/admin/storage-config`
        // (saving, the connection test and Create bucket need storage_config:write,
        // gated inside the page). Deliberately NOT `storage:read`, which gates object
        // access. No `feature`: it is where storage is set up.
        title: 'Storage',
        description: 'Where attachments, card faces, media and backups are kept: the bucket, its key, and a connection test.',
        Icon: StorageIcon,
        path: '/admin/settings/storage',
        permission: 'storage_config:read',
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
      {
        // E9.1 (#89), APPENDED last in Operations. The packaged `Database Backup` card as data:
        // `/admin/settings/db-backup`, `db_backup:read` (the platform DatabaseBackupController
        // `GET /api/admin/db-backup/config` and the run list; scheduling needs db_backup:write,
        // restore and rollback db_backup:restore, gated inside the page). The description is
        // Vault's own so it is not mistaken for the `Backups` card above, which is the encrypted
        // secret backup (docs/SECRETS.md).
        ...dbBackupAdminSections.operations[0],
        description:
          'Whole-database disaster recovery: scheduled pg_dump backups of everything, and restoring the entire database. Not the encrypted secret backups.',
      },
    ],
  },
  {
    // E7.2: the platform email and notifications slices (API mounted in E7.1,
    // #85). APPENDED as a section of its own, after Operations. Each page is
    // the packaged one; writes are gated inside it.
    label: 'Messaging',
    cards: [
      {
        title: 'Email',
        description: 'How Vault sends email (SMTP or SES), and a test message to prove it works.',
        Icon: EmailIcon,
        path: '/admin/settings/email',
        // The platform email-settings.controller `GET /api/email-settings`
        // (SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ); saving and test-sending need system_settings:write.
        permission: 'system_settings:read',
      },
      {
        title: 'Web Push',
        description: 'Generate, enable or rotate the VAPID key pair that lets Vault send browser push notifications.',
        Icon: PushIcon,
        path: '/admin/settings/push',
        // The platform push-config.controller `GET /api/admin/push-config` (`push:read`, a
        // pair of its own: rotating the keys silences every subscriber); changes need push:write.
        permission: 'push:read',
      },
      {
        title: 'Broadcasts',
        description: 'Write an announcement and send it to every active user now or later, then watch it go out.',
        Icon: BroadcastIcon,
        path: '/admin/settings/broadcasts',
        // The platform broadcasts.controller `GET /api/admin/broadcasts` admits
        // `broadcasts:read` OR `org_broadcasts:read`; Vault runs one organization and only
        // `admin` holds either, so the card and route name the system string. Composing,
        // cancelling and test-sending need broadcasts:write.
        permission: 'broadcasts:read',
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
