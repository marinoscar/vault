/**
 * The `ShellNavigation` the platform shell takes (E10.2, issue #93): the
 * destinations table plus the Console's registry, declared once at module
 * scope (the shell keys memoisation on the object identity).
 */

import type { ShellNavigation } from '@marinoscar/platform-web/shell/headless';

import { ADMIN_SECTIONS } from './adminSections';
import { DESTINATIONS, DESTINATION_ROUTES } from './destinations';
import type { DestinationKey } from './destinations';

export const VAULT_NAVIGATION: ShellNavigation<DestinationKey> = {
  destinations: DESTINATIONS,
  destinationRoutes: DESTINATION_ROUTES,
  // The compact AppBar's drill-down on the Console pages (back arrow + page
  // title below 600px). `/settings` joins as a surface in E10.3, with its registry.
  settingsSurfaces: [{ sections: ADMIN_SECTIONS, hubPath: '/admin/settings', hubTitle: 'Console' }],
  // Console MODE: on any `/admin` route the expanded rail lists the admin registry.
  console: { prefix: '/admin', sections: ADMIN_SECTIONS, back: { label: 'Back to Vault', path: '/' } },
};

/**
 * What the phone bottom bar draws: the navigation WITHOUT its pinned
 * destinations (a mode is never a peer on the bar). Derived, never a second
 * hand-written list, so the bar cannot grow a fifth tab by accident.
 */
export const BOTTOM_BAR_NAVIGATION: ShellNavigation<DestinationKey> = {
  ...VAULT_NAVIGATION,
  destinations: VAULT_NAVIGATION.destinations.filter((destination) => !destination.pinned),
};
