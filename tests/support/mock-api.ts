/**
 * The network-layer API for the visual and e2e suites (E10.7, #98).
 *
 * `installMockApi(page, options)` intercepts every `/api/**` request of a page
 * and answers it from the invented fixtures in `fixtures.ts`, with a small
 * in-memory state (created secrets, saved backups) so an e2e flow can write and
 * read back. No backend, database, storage account or AI key is involved.
 *
 * A request nothing handles is answered `404` and recorded in `unhandled`; the
 * visual specs assert the list is empty so a new API call on a screenshotted
 * page cannot silently go unmocked.
 *
 * Type-only imports: this file lives outside both suites' `node_modules`.
 */
import type { Page, Route } from '@playwright/test';
import {
  ACCESS_TOKEN,
  BACKUP_RUN,
  CARD_EXTRACTION,
  CARD_SUMMARIES,
  FROZEN_NOW,
  MEDIA_FOLDERS,
  SECRETS,
  SECRET_TYPES,
  makeUser,
  type FixtureSecret,
} from './fixtures';

export interface MockApiOptions {
  /** `admin` (default) sees the Console; `contributor` does not. */
  role?: 'admin' | 'contributor';
  /** Start with a refresh cookie (signed in). Default true; false shows the login page. */
  signedIn?: boolean;
  /** Start with no secrets (the first-run Home and an empty Secrets list). */
  empty?: boolean;
  /** Whether object storage is configured (My backups can be saved). Default true. */
  storageConfigured?: boolean;
}

export interface MockApi {
  /** Requests under `/api` that no handler answered. */
  unhandled: string[];
  /** Every `method path` the page requested, in order (for assertions). */
  requests: string[];
  /** Bodies POSTed to a path, by `method path`. */
  bodies: Record<string, unknown[]>;
  /** Live state an e2e spec can read. */
  state: { secrets: FixtureSecret[]; backups: unknown[] };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const page_ = (items: unknown[], pageNo = 1, pageSize = 20) => ({
  items,
  meta: { page: pageNo, pageSize, totalItems: items.length, totalPages: items.length ? 1 : 0 },
});

const listItem = (s: FixtureSecret) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  type: s.type,
  currentVersion: s.currentVersion,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const detail = (s: FixtureSecret) => ({
  ...listItem(s),
  values: s.values,
  createdBy: { id: 'user-person-a', email: 'person.a@example.test' },
  attachments: [],
});

const EMPTY_ONBOARDING = { steps: [], completed: 0, total: 0, requiredDone: true, allResolved: true };

export async function installMockApi(page: Page, options: MockApiOptions = {}): Promise<MockApi> {
  const { role = 'admin', signedIn = true, empty = false, storageConfigured = true } = options;
  const user = makeUser(role);
  const api: MockApi = {
    unhandled: [],
    requests: [],
    bodies: {},
    state: { secrets: empty ? [] : SECRETS.map((s) => ({ ...s })), backups: [] },
  };
  let loggedIn = signedIn;
  let nextId = 1;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method();
    api.requests.push(`${method} ${path}`);
    if (method !== 'GET') {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      (api.bodies[`${method} ${path}`] ??= []).push(body);
    }

    // ---- identity ----------------------------------------------------------
    if (path === '/auth/providers') {
      return json(route, { providers: [{ name: 'google', authUrl: '/api/auth/google' }] });
    }
    if (path === '/auth/refresh' && method === 'POST') {
      return loggedIn ? json(route, { data: { accessToken: ACCESS_TOKEN, expiresIn: 900 } }) : json(route, {}, 401);
    }
    if (path === '/auth/google') {
      // The OAuth round trip, collapsed: the provider redirects straight back with a token.
      loggedIn = true;
      return route.fulfill({
        status: 302,
        headers: { location: `/auth/callback?token=${ACCESS_TOKEN}` },
      });
    }
    if (path === '/auth/me') return json(route, { data: user });
    if (path === '/auth/logout') {
      loggedIn = false;
      return route.fulfill({ status: 204 });
    }

    // ---- settings, AI, notifications, onboarding ---------------------------
    if (path === '/user-settings') {
      return json(route, {
        data: { theme: 'system', profile: { displayName: null, useProviderImage: true, customImageUrl: null }, updatedAt: FROZEN_NOW, version: 1 },
      });
    }
    if (path === '/system-settings') {
      return json(route, {
        data: {
          ui: { allowUserThemeOverride: true },
          features: {},
          ai: { enabled: true, keyPolicy: 'byok_with_org_fallback', cardExtractModel: 'mock-vision-model' },
          updatedAt: FROZEN_NOW,
          updatedBy: null,
          version: 1,
        },
      });
    }
    if (path === '/ai/config') {
      // Card scanning available (vault-web `isCardScanAvailable`): AI on, the deployment
      // key serving everyone and the openai provider on with its key stored.
      return json(route, {
        data: {
          enabled: true,
          keyPolicy: 'byok_with_org_fallback',
          providers: [{ id: 'openai', displayName: 'OpenAI', enabled: true, hasOrgKey: true }],
        },
      });
    }
    if (path === '/telemetry/config') {
      return json(route, { data: { enabled: false, deployed: false } });
    }
    if (path === '/notifications/stream') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
    }
    if (path === '/notifications/unread-count') return json(route, { data: { unreadCount: 0 } });
    if (path === '/notifications/config') {
      return json(route, { data: { browserEnabled: true, pushEnabled: false, vapidPublicKey: null } });
    }
    if (path === '/notifications') {
      return json(route, { data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } });
    }
    if (path === '/onboarding') {
      return json(route, {
        data: {
          settings: { welcomeSeenAt: '2026-01-01T00:00:00.000Z', checklistDismissedAt: null, adminDismissedAt: null, skipped: [] },
          user: EMPTY_ONBOARDING,
          admin: null,
        },
      });
    }

    // ---- secret types ------------------------------------------------------
    if (path === '/secret-types') return json(route, { data: SECRET_TYPES });
    const typeMatch = path.match(/^\/secret-types\/([^/]+)$/);
    if (typeMatch) {
      const t = SECRET_TYPES.find((x) => x.id === typeMatch[1]);
      return t ? json(route, { data: t }) : json(route, { message: 'Not found' }, 404);
    }

    // ---- secrets -----------------------------------------------------------
    if (path === '/secrets' && method === 'GET') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const typeId = url.searchParams.get('typeId');
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      let items = [...api.state.secrets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (search) items = items.filter((s) => s.name.toLowerCase().includes(search));
      if (typeId) items = items.filter((s) => s.type.id === typeId);
      const shown = items.slice(0, pageSize).map(listItem);
      return json(route, {
        data: { items: shown, meta: { page: 1, pageSize, totalItems: items.length, totalPages: items.length ? 1 : 0 } },
      });
    }
    if (path === '/secrets' && method === 'POST') {
      const body = request.postDataJSON() as { name: string; description?: string; typeId: string; data: Record<string, unknown> };
      const type = SECRET_TYPES.find((t) => t.id === body.typeId) ?? SECRET_TYPES[0];
      const created: FixtureSecret = {
        id: `secret-created-${nextId++}`,
        name: body.name,
        description: body.description ?? null,
        type,
        currentVersion: 1,
        createdAt: FROZEN_NOW,
        updatedAt: FROZEN_NOW,
        values: body.data,
      };
      api.state.secrets.unshift(created);
      return json(route, { data: detail(created) }, 201);
    }
    if (path === '/secrets/cards/summary') {
      const cards = empty ? [] : CARD_SUMMARIES;
      return json(route, { data: page_(cards, 1, Number(url.searchParams.get('pageSize') ?? 20)) });
    }
    if (path === '/secrets/cards/extract' && method === 'POST') {
      return json(route, { data: CARD_EXTRACTION });
    }
    const secretMatch = path.match(/^\/secrets\/([^/]+)$/);
    if (secretMatch && method === 'GET') {
      const s = api.state.secrets.find((x) => x.id === secretMatch[1]);
      return s ? json(route, { data: detail(s) }) : json(route, { message: 'Not found' }, 404);
    }
    const versionsMatch = path.match(/^\/secrets\/([^/]+)\/versions$/);
    if (versionsMatch) return json(route, { data: [] });

    // ---- storage uploads (card photos) --------------------------------------
    if (path === '/storage/objects' && method === 'POST') {
      return json(
        route,
        { data: { id: `object-${nextId++}`, name: 'card.jpg', mimeType: 'image/jpeg', size: 1024, status: 'ready' } },
        201,
      );
    }
    const attachMatch = path.match(/^\/secrets\/([^/]+)\/attachments$/);
    if (attachMatch && method === 'POST') {
      return json(route, { data: { id: `attachment-${nextId++}`, label: null, role: null, storageObject: { id: 'o', name: 'card.jpg', mimeType: 'image/jpeg', size: 1024 }, createdAt: FROZEN_NOW } }, 201);
    }

    // ---- media -------------------------------------------------------------
    if (path === '/media/folders') {
      return json(route, { data: page_(empty ? [] : MEDIA_FOLDERS) });
    }

    // ---- backups -----------------------------------------------------------
    if (path === '/backups/me/config') {
      return json(route, { data: { storageConfigured, keepCount: 10 } });
    }
    if (path === '/backups/me' && method === 'GET') {
      const items = api.state.backups;
      return json(route, { data: { items, total: items.length, page: 1, pageSize: 10, totalPages: items.length ? 1 : 0 } });
    }
    if (path === '/backups/me' && method === 'POST') {
      const run = { ...BACKUP_RUN, id: `backup-me-${nextId++}`, trigger: 'manual', startedAt: FROZEN_NOW, finishedAt: FROZEN_NOW };
      api.state.backups.unshift(run);
      return json(route, { data: run }, 201);
    }
    if (path === '/admin/backups') {
      return json(route, { data: { items: [BACKUP_RUN], total: 1, page: 1, pageSize: 1, totalPages: 1 } });
    }
    if (path === '/admin/backups/schedule') {
      return json(route, {
        data: {
          enabled: true,
          frequency: 'daily',
          intervalHours: null,
          timeOfDay: '02:00',
          dayOfWeek: null,
          dayOfMonth: null,
          timezone: 'UTC',
          keepCount: 14,
          includeSecrets: true,
          includeAttachments: true,
          includeVersions: true,
          includeMedia: false,
          includeSystem: false,
          passwordConfigured: true,
          passwordUpdatedAt: '2026-05-01T00:00:00.000Z',
          nextRunAt: '2026-06-16T02:00:00.000Z',
          lastRunAt: '2026-06-14T02:00:09.000Z',
          storageConfigured: true,
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      });
    }

    api.unhandled.push(`${method} ${path}`);
    return json(route, { message: `Unmocked ${method} ${path}` }, 404);
  });

  return api;
}
