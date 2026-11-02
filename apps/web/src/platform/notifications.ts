/**
 * Vault's binding of the platform notifications slice (E7.2, follow-up to
 * issue #85; the API side is E7.1).
 *
 * `@marinoscar/platform-web/notifications/{headless,ui}` owns the notification
 * centre (`NotificationProvider`, the AppBar bell and its popover inbox), the
 * per-user preference page and the admin Web Push and Broadcasts pages. The
 * slice's services are plain module functions, so they reach the API through
 * the client configured ONCE, here, before anything renders: `main.tsx`
 * imports this module for that side effect.
 *
 *   - `api`: Vault's one HTTP client (`services/api.ts`): the same bearer token
 *     and the same refresh-and-retry-once on a 401 as every other Vault call.
 *     It already has the shape the slice takes (`get`/`post`/`put`/`delete`,
 *     `getAccessToken`, `refreshToken`), before and after E3.3 swaps its
 *     implementation for the platform's `PlatformHttpClient`.
 *   - `apiBaseUrl`: `/api` (same-origin hosting), for the SSE stream's URL.
 *   - `connectSse`: the packaged GET-with-bearer Server-Sent Events connector.
 *     Without it the inbox still loads but no live frame arrives.
 *
 * Web Push delivery to a closed tab needs the slice's service-worker handlers
 * in a BUILT worker; Vault's `public/sw.js` is a plain unbundled file, so the
 * shell does not run `usePushSubscriptionSync` yet (follow-up, listed in
 * docs/platform-adoption/local-exceptions.md).
 */

import { connectSse } from '@marinoscar/platform-web/core';
import { configureNotificationsWeb } from '@marinoscar/platform-web/notifications/headless';

import { api } from '../services/api';

/** Where the API lives: same origin unless a build overrides it. */
export const NOTIFICATIONS_API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || '/api';

configureNotificationsWeb({
  api,
  apiBaseUrl: NOTIFICATIONS_API_BASE_URL,
  connectSse,
});
