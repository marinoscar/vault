/**
 * Telemetry web/API permission parity (E9.2, #90; check 7 of the platform telemetry
 * conformance suite).
 *
 * The Settings UI Pattern (rule 3) says a card's `permission` is the exact string the API
 * controller enforces. For the packaged telemetry cards that is checkable without a
 * controller: the API package declares the permission strings as data, and the route table
 * is `App.tsx`. For every card in `telemetryAdminCards`:
 *
 *   - its permission is one of the slice's three, or `system_settings:read`;
 *   - the app registers it in the admin hub exactly once;
 *   - its path is a route of `App.tsx`, gated on the SAME permission.
 *
 * The check is a pure function over (cards, routes), exercised first on broken fixtures so
 * a check that cannot fail cannot pass the real cards by accident. It reads the LIVE
 * App.tsx, never a copy.
 */

import { describe, expect, it } from 'vitest';
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import appSource from '../../App.tsx?raw';
import telemetryPermissionsSource from '../../../../../node_modules/@marinoscar/platform-api/dist/telemetry/telemetry.permissions.js?raw';

/** The `'<resource>:<action>'` strings a permission declaration file names. */
const idsOf = (source: string): string[] => [...source.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);

/** The three the slice declares (`TELEMETRY_PERMISSIONS`), plus the settings read the services section uses. */
const ALLOWED: readonly string[] = [
  ...new Set(idsOf(telemetryPermissionsSource).filter((id) => id.startsWith('telemetry:'))),
  'system_settings:read',
];

interface Card {
  path: string;
  permission?: string;
}
interface RouteGate {
  path: string;
  permission: string | null;
}

/** Every `<Route>` in App.tsx as `path` -> the `permission` it wraps. */
function declaredRouteGates(): RouteGate[] {
  return appSource
    .split('<Route')
    .slice(1)
    .map((chunk) => ({
      path: /^\s*path="([^"]+)"/.exec(chunk)?.[1],
      permission: /permission="([^"]+)"/.exec(chunk)?.[1] ?? null,
    }))
    .filter((route): route is RouteGate => route.path !== undefined);
}

function parityProblems(
  cards: readonly Card[],
  routes: readonly RouteGate[],
  registered: readonly string[],
  allowed: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const card of cards) {
    if (!card.permission || !allowed.includes(card.permission)) {
      problems.push(`${card.path}: permission "${card.permission}" is not one of ${allowed.join(', ')}`);
    }
    const hubEntries = registered.filter((path) => path === card.path).length;
    if (hubEntries !== 1) problems.push(`${card.path}: registered ${hubEntries} times in the admin hub, expected once`);
    const matching = routes.filter((route) => route.path === card.path);
    if (matching.length !== 1) {
      problems.push(`${card.path}: ${matching.length} routes in App.tsx, expected one`);
    } else if (matching[0].permission !== (card.permission ?? null)) {
      problems.push(`${card.path}: the route is gated on "${matching[0].permission}" but the card on "${card.permission}"`);
    }
  }
  return problems;
}

describe('telemetry web/API permission parity: the check itself', () => {
  const route: RouteGate = { path: '/admin/settings/telemetry', permission: 'telemetry:read' };
  const card: Card = { path: '/admin/settings/telemetry', permission: 'telemetry:read' };

  it('accepts a card whose permission, hub entry and route agree', () => {
    expect(parityProblems([card], [route], [card.path], ALLOWED)).toEqual([]);
  });

  it('rejects an invented permission (the string the controller enforces is exact)', () => {
    expect(parityProblems([{ ...card, permission: 'telemetry:view' }], [route], [card.path], ALLOWED).join()).toMatch(/not one of/);
  });

  it('rejects a card with no route, a duplicated route and a card missing from the hub', () => {
    expect(parityProblems([card], [], [card.path], ALLOWED).join()).toMatch(/0 routes in App\.tsx/);
    expect(parityProblems([card], [route, route], [card.path], ALLOWED).join()).toMatch(/2 routes in App\.tsx/);
    expect(parityProblems([card], [route], [], ALLOWED).join()).toMatch(/registered 0 times/);
  });

  it('rejects a route gated more weakly or more strongly than its card', () => {
    expect(parityProblems([card], [{ ...route, permission: null }], [card.path], ALLOWED).join()).toMatch(/gated on "null"/);
    expect(parityProblems([card], [{ ...route, permission: 'telemetry:query' }], [card.path], ALLOWED).join()).toMatch(
      /gated on "telemetry:query"/,
    );
  });
});

describe('telemetry web/API permission parity: Vault', () => {
  it('has the three packaged cards, so the check is not vacuous', () => {
    expect(telemetryAdminCards.map((c) => c.title)).toEqual(['Telemetry', 'Telemetry Explorer', 'Telemetry Dashboard']);
  });

  it('every telemetry card names a permission the slice enforces, is registered once and routed behind the same permission', () => {
    const registered = ADMIN_SECTIONS.flatMap((section) => section.cards.map((c) => c.path ?? ''));
    expect(parityProblems(telemetryAdminCards, declaredRouteGates(), registered, ALLOWED)).toEqual([]);
  });

  it('the strings are the exact ones the API declares', () => {
    expect([...ALLOWED].sort()).toEqual(['system_settings:read', 'telemetry:query', 'telemetry:read', 'telemetry:write']);
  });

  it('puts the Explorer and Dashboard behind the telemetry feature, and the Telemetry card behind none', () => {
    const byTitle = Object.fromEntries(telemetryAdminCards.map((c) => [c.title, c.feature]));
    expect(byTitle).toEqual({ Telemetry: undefined, 'Telemetry Explorer': 'telemetry', 'Telemetry Dashboard': 'telemetry' });
  });
});
