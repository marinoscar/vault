/**
 * The settings registries (E10.3, #94; AGENTS.md Settings UI Pattern):
 * `ADMIN_SECTIONS` (Console hub, `/admin/settings`) and
 * `USER_SETTINGS_SECTIONS` (per-user hub, `/settings`).
 *
 *  1. Every card is routed, under its hub, once; every settings route in
 *     `App.tsx` belongs to a card (a card's own path or a page beneath it).
 *  2. A card's `permission` is the exact string the API controller enforces:
 *     it must be declared in the API's permission constants, and it must equal
 *     the controller mirror below (a change to either side fails here).
 *  3. Every card route in `App.tsx` is gated on exactly the card's permission.
 *  4. AI cards declare `feature: 'ai'`, except the admin card that switches AI on.
 */
import { describe, expect, it } from 'vitest';
import type { SettingsCardDef, SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';

import { ADMIN_HUB_PATH, ADMIN_SECTIONS } from '../../config/adminSections';
import { USER_HUB_PATH, USER_SETTINGS_SECTIONS } from '../../config/userSettingsSections';
import { DESTINATIONS } from '../../config/destinations';
import { VAULT_NAVIGATION } from '../../config/shell';
import appSource from '../../App.tsx?raw';
// The API's permission catalog (E3.2): roles.constants.ts DERIVES `PERMISSIONS` from
// the platform slices Vault seeds (apps/api/src/platform/permissions.ts) plus
// Vault's own (app-registrations/permissions.ts). Read the declarations themselves.
import vaultPermissionsSource from '../../../../api/src/app-registrations/permissions.ts?raw';
import permissionOptionsSource from '../../../../api/src/platform/permissions.ts?raw';
import rolesSource from '../../../../api/src/common/constants/roles.constants.ts?raw';
import settingsPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/settings/settings.permissions.js?raw';
import usersPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/identity/users/users.permissions.js?raw';
import allowlistPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/identity/allowlist/allowlist.permissions.js?raw';
import dbBackupPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/db-backup/db-backup.permissions.js?raw';
import notificationsPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/notifications/notifications.permissions.js?raw';
import aiPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/ai/ai.permissions.js?raw';
import aiAdminControllerSource from '../../../../../node_modules/@marinoscar/platform-api/dist/ai/config/ai-admin.controller.js?raw';
import aiUsageAdminControllerSource from '../../../../../node_modules/@marinoscar/platform-api/dist/ai/usage/ai-usage-admin.controller.js?raw';
import telemetryPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/telemetry/telemetry.permissions.js?raw';
// E6.1 web follow-up (#84): the platform storage slice's configuration permissions and controller.
import storageConfigPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/storage/config/storage-config.permissions.js?raw';
import storageConfigControllerSource from '../../../../../node_modules/@marinoscar/platform-api/dist/storage/config/storage-config.controller.js?raw';

const cardsOf = (sections: SettingsSectionDef[]): SettingsCardDef[] => sections.flatMap((s) => s.cards);
const ADMIN_CARDS = cardsOf(ADMIN_SECTIONS);
const USER_CARDS = cardsOf(USER_SETTINGS_SECTIONS);

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
const API_PERMISSIONS = new Set([
  ...declaredIds(vaultPermissionsSource),
  ...declaredIds(settingsPermissionsSource),
  ...declaredIds(usersPermissionsSource),
  ...declaredIds(allowlistPermissionsSource),
  ...declaredIds(notificationsPermissionsSource),
  ...declaredIds(dbBackupPermissionsSource),
  ...declaredIds(aiPermissionsSource),
  ...declaredIds(telemetryPermissionsSource),
  ...declaredIds(storageConfigPermissionsSource),
]);

/**
 * The controller mirror: card route -> the permission its page's READ route
 * enforces. Update it only together with the controller.
 */
const CONTROLLER_MIRROR: Record<string, string | undefined> = {
  // system-settings.controller.ts GET /api/system-settings
  '/admin/settings/general': 'system_settings:read',
  // users.controller.ts GET /api/users
  '/admin/settings/users': 'users:read',
  // E8.2, the platform AI slice: ai-admin.controller GET /api/admin/ai/config (ai_config:read)
  '/admin/settings/ai': 'ai_config:read',
  // backups.controller.ts GET /api/admin/backups/schedule and the run list
  '/admin/settings/backups': 'system_settings:read',
  // platform maintenance controller GET /api/admin/maintenance (default)
  '/admin/settings/maintenance': 'system_settings:read',
  // platform DoctorModule GET /api/admin/doctor (default, doctor.config.ts)
  '/admin/settings/doctor': 'system_settings:read',
  // platform about controller GET /api/admin/about (default)
  '/admin/settings/about': 'system_settings:read',
  // telemetry-admin.controller.ts GET /api/admin/telemetry/config (E9.2)
  '/admin/settings/telemetry': 'telemetry:read',
  // telemetry-explorer.controller.ts POST /api/admin/telemetry/query and the schema (E9.2)
  '/admin/settings/telemetry/explorer': 'telemetry:query',
  // telemetry-dashboard.controller.ts GET /api/admin/telemetry/dashboard/* (E9.2)
  '/admin/settings/telemetry/dashboard': 'telemetry:query',
  // user-settings.controller.ts GET /api/user-settings
  '/settings/profile': 'user_settings:read',
  '/settings/appearance': 'user_settings:read',
  // pat.controller.ts: bare @Auth(), ownership-scoped
  '/settings/tokens': undefined,
  // my-backups.controller.ts (every route)
  '/settings/backups': 'secrets:read',
  // secret-types.controller.ts GET /api/secret-types
  '/settings/secret-types': 'secret_types:read',
  // E7.2, the platform email and notifications slices:
  // email-settings.controller GET /api/email-settings (SYSTEM_SETTINGS_READ)
  '/admin/settings/email': 'system_settings:read',
  // push-config.controller GET /api/admin/push-config (PUSH_READ)
  '/admin/settings/push': 'push:read',
  // broadcasts.controller GET /api/admin/broadcasts (anyPermissions broadcasts:read | org_broadcasts:read;
  // Vault is single-organization, so the card names the system string)
  '/admin/settings/broadcasts': 'broadcasts:read',
  // UserNotificationsPage reads the caller's preferences from GET /api/user-settings
  '/settings/notifications': 'user_settings:read',
  // E9.1, the platform db-backup slice: DatabaseBackupController GET /api/admin/db-backup/config (db_backup:read)
  '/admin/settings/db-backup': 'db_backup:read',
  // ai-admin.controller GET /api/admin/ai/models (ai_config:read)
  '/admin/settings/ai/models': 'ai_config:read',
  // ai-usage-admin.controller GET /api/admin/ai/usage (ai_config:read)
  '/admin/settings/ai/usage': 'ai_config:read',
  // E6.1 web follow-up: the platform storage-config.controller GET /api/admin/storage-config (STORAGE_CONFIG_READ)
  '/admin/settings/storage': 'storage_config:read',
};

/**
 * Cards that sit BENEATH another card's route rather than directly under the
 * hub: the AI models and AI usage pages live at the paths the packaged AI pages
 * link to (`/admin/settings/ai/models`), under the `AI` card (E8.2).
 */
const NESTED_CARD_PATHS = new Set(['/admin/settings/ai/models', '/admin/settings/ai/usage']);

/** `App.tsx` routes: path -> the single `permission="..."` its RequirePermission gate names (or null). */
function appRouteGates(): Map<string, string | null> {
  const gates = new Map<string, string | null>();
  for (const match of appSource.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)\/>/g)) {
    const [, path, rest] = match;
    const gate = /^\s*element=\{<RequirePermission\s+permission="([^"]+)"/.exec(rest);
    gates.set(path, gate ? gate[1] : null);
  }
  return gates;
}

const GATES = appRouteGates();

describe.each([
  ['ADMIN_SECTIONS', ADMIN_SECTIONS, ADMIN_HUB_PATH],
  ['USER_SETTINGS_SECTIONS', USER_SETTINGS_SECTIONS, USER_HUB_PATH],
] as const)('%s', (_name, sections, hubPath) => {
  const cards = cardsOf(sections);

  it('has non-empty sections of complete cards', () => {
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.label).toBeTruthy();
      expect(section.cards.length).toBeGreaterThan(0);
    }
    for (const card of cards) {
      expect(card.title).toBeTruthy();
      expect(card.description).toBeTruthy();
      expect(card.Icon).toBeTruthy();
    }
  });

  it('routes every card once, directly under its hub', () => {
    const paths = cards.map((card) => card.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path).toBeDefined();
      expect(path!.startsWith(`${hubPath}/`)).toBe(true);
      if (NESTED_CARD_PATHS.has(path!)) {
        // Beneath a sibling card, gated alike.
        const parent = cards.find((c) => c.path !== path && path!.startsWith(`${c.path}/`));
        expect(parent, path).toBeDefined();
        expect(parent!.permission).toBe(cards.find((c) => c.path === path)!.permission);
      } else if (/^telemetry\/(explorer|dashboard)$/.test(path!.slice(hubPath.length + 1))) {
        // The packaged telemetry Explorer and Dashboard nest under the Telemetry card, as the platform
        // declares them (E9.2, #90). Their permission (`telemetry:query`) differs from the parent's.
        expect(paths).toContain(`${hubPath}/telemetry`);
      } else {
        expect(path!.slice(hubPath.length + 1)).not.toContain('/');
      }
      expect(GATES.has(path!)).toBe(true);
    }
  });

  it('gates each card on a permission the API declares, exactly as the controller enforces it', () => {
    for (const card of cards) {
      expect(card.path! in CONTROLLER_MIRROR).toBe(true);
      expect(card.permission).toBe(CONTROLLER_MIRROR[card.path!]);
      if (card.permission !== undefined) expect(API_PERMISSIONS.has(card.permission as string)).toBe(true);
    }
  });

  it('gates every card route in App.tsx on exactly the card permission (none for an ungated card)', () => {
    for (const card of cards) {
      expect(GATES.get(card.path!)).toBe(card.permission ?? null);
    }
  });

  it('owns every settings route in App.tsx (a card path or a page beneath one)', () => {
    const routes = [...GATES.keys()].filter((path) => path.startsWith(`${hubPath}/`));
    for (const route of routes) {
      const owner =
        cards.find((card) => route === card.path) ??
        cards.find((card) => route.startsWith(`${card.path}/`));
      expect(owner, route).toBeDefined();
      // A page beneath a card is gated like the card.
      expect(GATES.get(route)).toBe(owner!.permission ?? null);
    }
  });

  it('declares feature "ai" on every AI card except the admin card that switches AI on', () => {
    const aiCards = cards.filter((card) => card.feature === 'ai' || /\/ai(\/|$)/.test(card.path ?? ''));
    for (const card of aiCards) {
      if (card.path === '/admin/settings/ai') expect(card.feature).toBeUndefined();
      else expect(card.feature).toBe('ai');
    }
  });
});

describe('the AI cards (E8.2, the platform AI slice)', () => {
  const byPath = (path: string) => ADMIN_CARDS.find((card) => card.path === path);

  it('gates AI, AI models and AI usage on ai_config:read, the string the platform controllers enforce', () => {
    for (const path of ['/admin/settings/ai', '/admin/settings/ai/models', '/admin/settings/ai/usage']) {
      expect(byPath(path)?.permission, path).toBe('ai_config:read');
    }
    // The controllers' own route tables name it (the comment block above each class).
    expect(aiAdminControllerSource).toMatch(/GET\s+\/api\/admin\/ai\/config\s+ai_config:read/);
    expect(aiAdminControllerSource).toMatch(/GET\s+\/api\/admin\/ai\/models\s+ai_config:read/);
    expect(aiUsageAdminControllerSource).toMatch(/GET \/api\/admin\/ai\/usage\s+ai_config:read/);
  });

  it('hides AI models and AI usage while AI is off, never the AI card that switches it on', () => {
    expect(byPath('/admin/settings/ai')?.feature).toBeUndefined();
    expect(byPath('/admin/settings/ai/models')?.feature).toBe('ai');
    expect(byPath('/admin/settings/ai/usage')?.feature).toBe('ai');
  });

  it('routes the AI models and AI usage pages behind RequireAiEnabled inside the permission gate', () => {
    for (const page of ['AiModelsPage', 'AiUsagePage']) {
      expect(appSource).toMatch(
        new RegExp(`<RequirePermission permission="ai_config:read" fallback=\\{TO_HOME\\}><RequireAiEnabled><${page} />`),
      );
    }
  });

  it('mounts the AI config and the AI adapters (Vault\'s spinner) around the routes', () => {
    expect(appSource).toContain('<VaultAiConfigProvider>');
    expect(appSource).toContain('<AiWebAdaptersProvider adapters={vaultAiAdapters}>');
  });
});

describe('the Storage card (E6.1 web follow-up, the platform storage slice)', () => {
  const card = ADMIN_CARDS.find((c) => c.path === '/admin/settings/storage');

  it('is the last Administration card, gated on storage_config:read with no feature', () => {
    const administration = ADMIN_SECTIONS.find((s) => s.label === 'Administration')!;
    expect(administration.cards[administration.cards.length - 1]).toBe(card);
    expect(card?.title).toBe('Storage');
    expect(card?.permission).toBe('storage_config:read');
    expect(card?.feature).toBeUndefined();
  });

  it('names the string the platform storage-config controller enforces on its GET', () => {
    expect(declaredIds(storageConfigPermissionsSource)).toEqual(
      expect.arrayContaining(['storage_config:read', 'storage_config:write']),
    );
    // The GET handler's decorator block: Get() then Auth({ permissions: [STORAGE_CONFIG_READ] }).
    expect(storageConfigControllerSource).toMatch(
      /common_1\.Get\)\(\),\s*\(0, index_1\.Auth\)\(\{ permissions: \[storage_constants_1\.PERMISSIONS\.STORAGE_CONFIG_READ\] \}\)/,
    );
    // And not the object-access pair.
    expect(card?.permission).not.toBe('storage:read');
  });

  it('routes the packaged StorageConfigPage behind the same permission', () => {
    expect(appSource).toContain("import('@marinoscar/platform-web/storage/ui')");
    expect(appSource).toMatch(
      /path="\/admin\/settings\/storage"\s*element=\{<RequirePermission permission="storage_config:read" fallback=\{TO_HOME\}><StorageConfigPage \/>/,
    );
  });
});

describe('the registries as a whole', () => {
  it('lists the cards in append order (E10.3, then E7.2, then E8.2, then E6.1 Storage)', () => {
    expect(ADMIN_CARDS.map((card) => card.title)).toEqual([
      'General',
      'Users & Allowlist',
      'AI',
      'Backups',
      'AI models',
      'AI usage',
      'Storage',
      'Maintenance',
      'Doctor',
      'About',
      'Database Backup',
      'Email',
      'Web Push',
      'Broadcasts',
      'Telemetry',
      'Telemetry Explorer',
      'Telemetry Dashboard',
    ]);
    expect(USER_CARDS.map((card) => card.title)).toEqual([
      'Profile',
      'Appearance',
      'Access Tokens',
      'My backups',
      'Secret types',
      'Notifications',
    ]);
  });

  it('has no Advanced (JSON) card (spec section 6 drops it)', () => {
    expect([...ADMIN_CARDS, ...USER_CARDS].some((card) => /advanced|json/i.test(card.title))).toBe(false);
  });

  it('gates the Console hub route exactly like the console destination', () => {
    const consoleDest = DESTINATIONS.find((d) => d.key === 'console')!;
    const hubRoute = /path="\/admin\/settings"\s*element=\{<RequirePermission\s+permissions=\{\[([^\]]+)\]\}/.exec(appSource);
    expect(hubRoute).not.toBeNull();
    const perms = [...hubRoute![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(perms).toEqual(consoleDest.anyPermission);
    // Every admin card is reachable by some holder of the hub gate.
    // The `telemetry:*` cards are held by the admin role only, which also holds the hub gate's
    // `system_settings:read`: the page gate (not the hub gate) is what checks the telemetry string.
    for (const card of ADMIN_CARDS.filter((c) => !/^telemetry:/.test(String(c.permission ?? '')))) {
      expect(perms).toContain(card.permission as string);
    }
  });

  it('leaves the per-user hub ungated (every user owns their settings)', () => {
    expect(GATES.get(USER_HUB_PATH)).toBeNull();
  });

  it('binds both hubs as settings surfaces and the Console mode to ADMIN_SECTIONS', () => {
    expect(VAULT_NAVIGATION.settingsSurfaces).toEqual([
      expect.objectContaining({ sections: ADMIN_SECTIONS, hubPath: ADMIN_HUB_PATH }),
      expect.objectContaining({ sections: USER_SETTINGS_SECTIONS, hubPath: USER_HUB_PATH }),
    ]);
    expect(VAULT_NAVIGATION.console?.sections).toBe(ADMIN_SECTIONS);
  });

  it('keeps the old URLs as redirects', () => {
    for (const [from, to] of [
      ['/admin/users', '/admin/settings/users'],
      ['/admin', '/admin/settings'],
      ['/secret-types', '/settings/secret-types'],
      ['/secret-types/new', '/settings/secret-types/new'],
    ]) {
      expect(appSource).toContain(`<Route path="${from}" element={<Navigate to="${to}" replace />} />`);
    }
    expect(appSource).toContain('<Route path="/secret-types/:id/edit" element={<SecretTypeEditRedirect />} />');
  });

  it('reads the API permission catalog from its declarations (sanity)', () => {
    // The sources are the ones the API composes PERMISSIONS from.
    expect(rolesSource).toContain('permissionIds(PLATFORM_PERMISSIONS)');
    expect(rolesSource).toContain('permissionIds(VAULT_PERMISSIONS)');
    // Vault seeds the platform slices whose declarations are read above.
    const slices = /slices:\s*\[([^\]]*)\]/.exec(permissionOptionsSource)?.[1] ?? '';
    expect(slices).toContain("'identity'");
    expect(slices).toContain("'settings'");
    expect(slices).toContain("'notifications'");
    // Each file contributed (a moved dist file must fail here, not pass silently).
    expect(declaredIds(vaultPermissionsSource)).toEqual(expect.arrayContaining(['secrets:read', 'secret_types:read']));
    expect(declaredIds(settingsPermissionsSource)).toEqual(
      expect.arrayContaining(['system_settings:read', 'user_settings:read']),
    );
    expect(declaredIds(usersPermissionsSource)).toContain('users:read');
    expect(declaredIds(allowlistPermissionsSource)).toContain('allowlist:read');
    expect(declaredIds(notificationsPermissionsSource)).toEqual(
      expect.arrayContaining(['broadcasts:read', 'push:read']),
    );
    expect(slices).toContain("'ai'");
    expect(declaredIds(aiPermissionsSource)).toEqual(
      expect.arrayContaining(['ai_config:read', 'ai_config:write', 'ai:use']),
    );
    expect(declaredIds(telemetryPermissionsSource)).toEqual(
      expect.arrayContaining(['telemetry:read', 'telemetry:write', 'telemetry:query']),
    );
    expect(slices).toContain("'telemetry'");
    expect(slices).toContain("'storage'");
    // No invented string sneaks in through a loose pattern.
    for (const id of API_PERMISSIONS) expect(id).toMatch(/^[a-z_]+:[a-z_]+$/);
  });
});
