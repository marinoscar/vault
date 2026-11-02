/**
 * The `ShellNavigation` the platform shell takes (E10.2, issue #93): the
 * destinations table plus the Console's registry, declared once at module
 * scope (the shell keys memoisation on the object identity).
 */

import type { ShellNavigation } from '@marinoscar/platform-web/shell/headless';

import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from './adminSections';
import { DESTINATIONS, DESTINATION_ROUTES } from './destinations';
import type { DestinationKey } from './destinations';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from './userSettingsSections';

export const VAULT_NAVIGATION: ShellNavigation<DestinationKey> = {
  destinations: DESTINATIONS,
  destinationRoutes: DESTINATION_ROUTES,
  // The compact AppBar's drill-down (back arrow + page title below 600px) on
  // every card page of both hubs (E10.3): the title comes from the card.
  settingsSurfaces: [
    { sections: ADMIN_SECTIONS, hubPath: ADMIN_HUB_PATH, hubTitle: ADMIN_HUB_TITLE },
    { sections: USER_SETTINGS_SECTIONS, hubPath: USER_HUB_PATH, hubTitle: USER_HUB_TITLE },
  ],
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
