import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  DESTINATION_ROUTES,
  UNOWNED_ROUTES,
  isDestinationVisible,
  owns,
  resolveActiveDestination,
} from '../../config/destinations';
import { ADMIN_SECTIONS } from '../../config/adminSections';
import { BOTTOM_BAR_NAVIGATION, VAULT_NAVIGATION } from '../../config/shell';
import appSource from '../../App.tsx?raw';

/** Every `path="..."` route declared in App.tsx, with params filled in. */
function appRoutes(): string[] {
  const paths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  return paths.filter((p) => p !== '*').map((p) => p.replace(/:[A-Za-z]+/g, 'sample-id'));
}

/**
 * The exact permission strings the API controllers enforce (apps/api roles.constants.ts;
 * `push:read` and `broadcasts:read` are the platform notifications slice's, E7).
 */
const CONTROLLER_PERMISSIONS = new Set([
  'secrets:read',
  'media:read',
  'system_settings:read',
  'users:read',
  'push:read',
  'broadcasts:read',
  // The platform AI slice's admin controllers (E8.2: AI, AI models, AI usage cards).
  'ai_config:read',
  // The platform storage slice's storage-config controller (E6.1 web follow-up: Storage card).
  'storage_config:read',
]);

describe('destinations table', () => {
  it('declares Home, Secrets, Cards, Media, Settings, Console in that order', () => {
    expect(DESTINATIONS.map((d) => d.key)).toEqual(['home', 'secrets', 'cards', 'media', 'settings', 'console']);
  });

  it('has at most four non-pinned destinations (the phone bar ceiling)', () => {
    const nonPinned = DESTINATIONS.filter((d) => !d.pinned);
    expect(nonPinned.length).toBeLessThanOrEqual(4);
    expect(nonPinned.map((d) => d.key)).toEqual(['home', 'secrets', 'cards', 'media']);
  });

  it('pins Settings and Console (modes, not peers)', () => {
    expect(DESTINATIONS.filter((d) => d.pinned).map((d) => d.key)).toEqual(['settings', 'console']);
  });

  it('gives the bottom bar only the non-pinned destinations', () => {
    expect(BOTTOM_BAR_NAVIGATION.destinations.some((d) => d.pinned)).toBe(false);
    expect(BOTTOM_BAR_NAVIGATION.destinations.length).toBeLessThanOrEqual(4);
    expect(BOTTOM_BAR_NAVIGATION.destinationRoutes).toBe(VAULT_NAVIGATION.destinationRoutes);
  });

  it('gates only on exact controller permission strings', () => {
    for (const d of DESTINATIONS) {
      for (const p of [d.permission, ...(d.anyPermission ?? [])].filter(Boolean)) {
        expect(CONTROLLER_PERMISSIONS.has(p as string)).toBe(true);
      }
    }
  });

  it('shows Console to a holder of any Console card permission, and to nobody else', () => {
    const consoleDest = DESTINATIONS.find((d) => d.key === 'console')!;
    const holds = (perms: string[]) => (p: string) => perms.includes(p);
    expect(isDestinationVisible(consoleDest, holds(['system_settings:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['users:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['push:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['broadcasts:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['ai_config:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['storage_config:read']))).toBe(true);
    expect(isDestinationVisible(consoleDest, holds(['secrets:read']))).toBe(false);
  });

  it('every destination navigates to a route it owns', () => {
    for (const d of DESTINATIONS) {
      expect(resolveActiveDestination(DESTINATION_ROUTES, d.path)).toBe(d.key);
    }
  });

  it('matches on segment boundaries', () => {
    expect(owns('/settings', '/settingsfoo')).toBe(false);
    expect(owns('/', '/secrets')).toBe(false);
    expect(resolveActiveDestination(DESTINATION_ROUTES, '/secretsx')).toBeNull();
  });
});

describe('route ownership against App.tsx', () => {
  const routes = appRoutes();

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(routes)('%s is owned by exactly one destination, or deliberately by none', (route) => {
    const owners = (Object.entries(DESTINATION_ROUTES) as [string, readonly string[]][])
      .filter(([, prefixes]) => prefixes.some((prefix) => owns(prefix, route)))
      .map(([key]) => key);
    if (UNOWNED_ROUTES.includes(route)) {
      expect(owners).toEqual([]);
    } else {
      expect(owners).toHaveLength(1);
    }
  });

  it('routes every Console card path', () => {
    const cardPaths = ADMIN_SECTIONS.flatMap((s) => s.cards).map((c) => c.path);
    for (const path of cardPaths) expect(routes).toContain(path);
  });
});
