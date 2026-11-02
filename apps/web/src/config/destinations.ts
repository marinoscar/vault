/**
 * Vault's navigation destinations: the SINGLE table the platform shell's rail,
 * phone bottom bar and avatar menu draw (E10.2, issue #93; spec:
 * docs/specs/ux-refresh.md §2).
 *
 * Rules this table keeps (each asserted by `__tests__/config/destinations.test.ts`):
 *
 *  1. Every route in `App.tsx` is owned by EXACTLY ONE destination, or is listed
 *     in `UNOWNED_ROUTES` (reached from outside the signed-in shell).
 *  2. At most FOUR non-pinned destinations: Home, Secrets, Cards, Media. A fifth
 *     is a redesign of the phone bar, not an addition.
 *  3. `settings` and `console` are `pinned`: a MODE, not a peer. They sit at the
 *     rail's foot and in the avatar menu, never on the bottom bar
 *     (`BOTTOM_BAR_NAVIGATION` in `config/shell.ts` drops them).
 *  4. A gate is the exact permission string the API controller enforces, never
 *     a role: `secrets:read` (`secrets.controller.ts`, and cards are secrets of
 *     the Card type), `media:read` (`media.controller.ts`), and for the Console
 *     `system_settings:read` (`system-settings.controller.ts`), `users:read`
 *     (`users.controller.ts`), `push:read` (the platform `push-config.controller`)
 *     or `broadcasts:read` (the platform `broadcasts.controller`).
 *
 * Matching (`owns`, longest prefix wins, segment boundaries) and visibility
 * (`isDestinationVisible`) are the platform's; re-exported here so callers and
 * tests ask one function.
 */

import type { ShellDestination } from '@marinoscar/platform-web/shell/headless';
import HomeIcon from '@mui/icons-material/HomeOutlined';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import CardIcon from '@mui/icons-material/CreditCardOutlined';
import MediaIcon from '@mui/icons-material/PermMediaOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import ConsoleIcon from '@mui/icons-material/AdminPanelSettingsOutlined';

export { isDestinationVisible, owns, resolveActiveDestination } from '@marinoscar/platform-web/shell/headless';

export type DestinationKey = 'home' | 'secrets' | 'cards' | 'media' | 'settings' | 'console';

export type Destination = ShellDestination<DestinationKey>;

/** The six destinations, in navigation order (declaration order is the order everywhere). */
export const DESTINATIONS: readonly Destination[] = [
  { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
  {
    key: 'secrets',
    label: 'Secrets',
    compactLabel: 'Secrets',
    Icon: KeyIcon,
    path: '/secrets',
    permission: 'secrets:read',
  },
  {
    key: 'cards',
    label: 'Cards',
    compactLabel: 'Cards',
    Icon: CardIcon,
    path: '/cards',
    permission: 'secrets:read',
  },
  {
    key: 'media',
    label: 'Media',
    compactLabel: 'Media',
    Icon: MediaIcon,
    path: '/media',
    permission: 'media:read',
  },
  {
    key: 'settings',
    label: 'Settings',
    compactLabel: 'Settings',
    Icon: SettingsIcon,
    path: '/settings',
    // Any signed-in user; the cards inside are gated. Declared before Console so
    // the rail's foot reads Settings, then the operator surface.
    pinned: true,
  },
  {
    key: 'console',
    label: 'Console',
    compactLabel: 'Console',
    Icon: ConsoleIcon,
    path: '/admin/settings',
    // Any-of: every Console card is reachable by a holder of one of these
    // (push:read and broadcasts:read are the E7.2 Web Push and Broadcasts cards,
    // ai_config:read the E8.2 AI, AI models and AI usage cards, db_backup:read the E9.1 Database Backup card).
    anyPermission: ['system_settings:read', 'users:read', 'push:read', 'broadcasts:read', 'ai_config:read', 'db_backup:read'],
    pinned: true,
  },
];

/**
 * The route prefixes each destination OWNS (lights up on). Child routes are
 * covered by their prefix.
 *
 * - `settings` also owns `/secret-types`: since E10.3 the secret types pages
 *   live under their card (`/settings/secret-types/*`) and the old routes are
 *   redirects kept for bookmarks; they still light up Settings.
 * - `console` navigates to `/admin/settings` but owns all of `/admin` (the
 *   `/admin` and `/admin/users` redirects too), which is also the prefix of
 *   the rail's Console mode.
 */
export const DESTINATION_ROUTES: Readonly<Record<DestinationKey, readonly string[]>> = {
  home: ['/'],
  secrets: ['/secrets'],
  cards: ['/cards'],
  media: ['/media'],
  settings: ['/settings', '/secret-types'],
  console: ['/admin'],
};

/**
 * Routes deliberately owned by NO destination: reached from outside the
 * signed-in shell (sign-in, the OAuth callback, the full-screen device
 * activation, the dev-only test login). No row lights up there, by design.
 */
export const UNOWNED_ROUTES: readonly string[] = ['/login', '/auth/callback', '/activate', '/testing/login'];
