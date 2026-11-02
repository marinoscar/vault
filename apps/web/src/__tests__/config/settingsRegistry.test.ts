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

const cardsOf = (sections: SettingsSectionDef[]): SettingsCardDef[] => sections.flatMap((s) => s.cards);
const ADMIN_CARDS = cardsOf(ADMIN_SECTIONS);
const USER_CARDS = cardsOf(USER_SETTINGS_SECTIONS);

/** The `id: '<resource>:<action>'` strings a permission declaration file declares. */
const declaredIds = (source: string): string[] =>
  [...source.matchAll(/\bid:\s*'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);

/**
 * Every permission string the API declares and seeds: Vault's own
 * (`VAULT_PERMISSIONS`) plus the platform `identity` (users, allowlist) and
 * `settings` slices, which `PERMISSION_OPTIONS` lists (asserted below, so a
 * slice Vault stops seeding drops its strings from this set).
 */
const API_PERMISSIONS = new Set([
  ...declaredIds(vaultPermissionsSource),
  ...declaredIds(settingsPermissionsSource),
  ...declaredIds(usersPermissionsSource),
  ...declaredIds(allowlistPermissionsSource),
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
  // system-settings.controller.ts (ai namespace); ai-verify.controller.ts needs :write
  '/admin/settings/ai': 'system_settings:read',
  // backups.controller.ts GET /api/admin/backups/schedule and the run list
  '/admin/settings/backups': 'system_settings:read',
  // platform maintenance controller GET /api/admin/maintenance (default)
  '/admin/settings/maintenance': 'system_settings:read',
  // platform DoctorModule GET /api/admin/doctor (default, doctor.config.ts)
  '/admin/settings/doctor': 'system_settings:read',
  // platform about controller GET /api/admin/about (default)
  '/admin/settings/about': 'system_settings:read',
  // user-settings.controller.ts GET /api/user-settings
  '/settings/profile': 'user_settings:read',
  '/settings/appearance': 'user_settings:read',
  // pat.controller.ts: bare @Auth(), ownership-scoped
  '/settings/tokens': undefined,
  // my-backups.controller.ts (every route)
  '/settings/backups': 'secrets:read',
  // secret-types.controller.ts GET /api/secret-types
  '/settings/secret-types': 'secret_types:read',
};

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
      expect(path!.slice(hubPath.length + 1)).not.toContain('/');
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
      const owner = cards.find((card) => route === card.path || route.startsWith(`${card.path}/`));
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

describe('the registries as a whole', () => {
  it('lists the E10.3 cards in append order', () => {
    expect(ADMIN_CARDS.map((card) => card.title)).toEqual([
      'General',
      'Users & allowlist',
      'AI',
      'Backups',
      'Maintenance',
      'Doctor',
      'About',
    ]);
    expect(USER_CARDS.map((card) => card.title)).toEqual([
      'Profile',
      'Appearance',
      'Access tokens',
      'My backups',
      'Secret types',
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
    for (const card of ADMIN_CARDS) expect(perms).toContain(card.permission);
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
    // Each file contributed (a moved dist file must fail here, not pass silently).
    expect(declaredIds(vaultPermissionsSource)).toEqual(expect.arrayContaining(['secrets:read', 'secret_types:read']));
    expect(declaredIds(settingsPermissionsSource)).toEqual(
      expect.arrayContaining(['system_settings:read', 'user_settings:read']),
    );
    expect(declaredIds(usersPermissionsSource)).toContain('users:read');
    expect(declaredIds(allowlistPermissionsSource)).toContain('allowlist:read');
    // No invented string sneaks in through a loose pattern.
    for (const id of API_PERMISSIONS) expect(id).toMatch(/^[a-z_]+:[a-z_]+$/);
  });
});
