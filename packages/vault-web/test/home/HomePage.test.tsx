import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import HomePage from '../../src/home/ui/pages/HomePage.js';
import type { CardSummaryItem, SecretListItem } from '../../src/core/headless/types.js';
import {
  HOUR,
  NOW,
  ago,
  cardType,
  loginType,
  makeRun,
  makeSchedule,
  makeSecret,
} from './homeFixtures.js';
import { aiConfigPayload } from '../mocks/aiConfig.js';

const API = '*/api';

// ---------------------------------------------------------------------------
// Users: each permission set the dashboard gates on.
// ---------------------------------------------------------------------------
const withPerms = (permissions: string[], extra: Partial<MockUser> = {}): MockUser => ({
  ...mockUser,
  displayName: 'Person A',
  permissions: ['user_settings:read', 'user_settings:write', ...permissions],
  ...extra,
});
const READER = withPerms(['secrets:read']);
// `ai:use` (E8.2): Scan a card needs it as well as secrets:write.
const WRITER = withPerms(['secrets:read', 'secrets:write', 'media:read', 'ai:use']);
const ADMIN = withPerms(['secrets:read', 'secrets:write', 'media:read', 'system_settings:read', 'ai:use'], {
  roles: [{ name: 'admin' }],
});
const NO_ACCESS = withPerms([]);

// ---------------------------------------------------------------------------
// Invented data: test PANs only, expiries relative to NOW (2026-11-02).
// ---------------------------------------------------------------------------
const RECENT: SecretListItem[] = [
  makeSecret('s1', 'Product X admin', 0.5 * HOUR),
  makeSecret('s2', 'Org Alpha deploy key', 5 * HOUR),
  makeSecret('s3', 'Staging database', 26 * HOUR),
];

// The summary endpoint's shape (#118): last four digits and expiry only,
// already sorted soonest expiry first, as the API returns it.
function card(id: string, name: string, last4: string, expMonth: number, expYear: number): CardSummaryItem {
  return {
    id,
    name,
    last4,
    expMonth,
    expYear,
    network: null,
    kind: null,
    issuingBank: null,
    cardholderName: null,
    hasPhotos: false,
    updatedAt: ago(300 * HOUR),
  };
}
const CARDS = [
  card('c1', 'Test Visa travel', '4242', 10, 2026), // expired
  card('c2', 'Test Mastercard', '4444', 12, 2026), // expiring within 60 days
  card('c3', 'Test Discover', '1117', 8, 2029), // valid
];

interface ApiOptions {
  recentTotal?: number;
  recent?: SecretListItem[];
  failRecent?: boolean;
  aiEnabled?: boolean;
  systemFailed?: boolean;
}

const requests: string[] = [];
const DASHBOARD_ENDPOINT = /^\/api\/(secrets|secret-types|backups|admin|media|ai)\b/;

function mockApi(options: ApiOptions = {}) {
  const recent = options.recent ?? RECENT;
  let recentFailures = options.failRecent ? 1 : 0;
  server.use(
    http.get(`${API}/secret-types`, () => HttpResponse.json({ data: [loginType, cardType] })),
    http.get(`${API}/secrets/cards/summary`, () =>
      HttpResponse.json({
        data: { items: CARDS, meta: { page: 1, pageSize: 100, totalItems: CARDS.length, totalPages: 1 } },
      }),
    ),
    http.get(`${API}/secrets`, () => {
      if (recentFailures > 0) {
        recentFailures -= 1;
        return HttpResponse.json({ message: 'Recent secrets are down' }, { status: 500 });
      }
      return HttpResponse.json({
        data: {
          items: recent,
          meta: { page: 1, pageSize: 5, totalItems: options.recentTotal ?? 37, totalPages: 8 },
        },
      });
    }),
    // Home must never ask for a card's detail; answer loudly if it does.
    http.get(`${API}/secrets/:id`, () => new HttpResponse(null, { status: 500 })),
    http.get(`${API}/backups/me`, () =>
      HttpResponse.json({ data: { items: [makeRun()], total: 4, page: 1, pageSize: 1, totalPages: 4 } }),
    ),
    http.get(`${API}/admin/backups`, () =>
      HttpResponse.json({
        data: {
          items: [
            makeRun({
              id: 'run-9',
              trigger: 'schedule',
              status: options.systemFailed ? 'failed' : 'succeeded',
              error: options.systemFailed ? 'Storage upload failed' : null,
            }),
          ],
          total: 1,
          page: 1,
          pageSize: 1,
          totalPages: 1,
        },
      }),
    ),
    http.get(`${API}/admin/backups/schedule`, () => HttpResponse.json({ data: makeSchedule() })),
    http.get(`${API}/media/folders`, () =>
      HttpResponse.json({ data: { items: [], meta: { page: 1, pageSize: 1, totalItems: 6, totalPages: 6 } } }),
    ),
    http.get(`${API}/ai/config`, () => HttpResponse.json({ data: aiConfigPayload(options.aiEnabled ?? true) })),
  );
}

/** Requests per path (query string dropped), dashboard endpoints only. */
function countsByPath(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of requests) {
    const path = entry.split('?')[0];
    if (DASHBOARD_ENDPOINT.test(path)) counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
}

function renderHome(user: MockUser) {
  return render(<HomePage />, { wrapperOptions: { authenticated: true, user } });
}

/** Wait until every panel the user can see has settled. */
async function settled() {
  await waitFor(() => expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0));
  await waitFor(() => expect(document.querySelectorAll('.MuiSkeleton-root')).toHaveLength(0));
}

describe('HomePage', () => {
  beforeEach(() => {
    // Only Date is faked: MSW and React still need real timers and promises.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    requests.length = 0;
    server.events.removeAllListeners('request:start');
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
    });
  });

  afterEach(() => {
    server.events.removeAllListeners('request:start');
    vi.useRealTimers();
  });

  describe('Greeting', () => {
    it('greets the user by name for the time of day, with the subtitle', async () => {
      mockApi();
      renderHome(READER);

      expect(screen.getByRole('heading', { level: 1, name: 'Good morning, Person A' })).toBeInTheDocument();
      expect(screen.getByText("Here's what's happening in your vault")).toBeInTheDocument();
      await settled();
    });

    it('greets without a name when there is none', async () => {
      mockApi();
      renderHome({ ...READER, displayName: null });

      expect(screen.getByRole('heading', { level: 1, name: 'Good morning' })).toBeInTheDocument();
      await settled();
    });

    it('renders inside a max-width lg container without gutters of its own', async () => {
      mockApi();
      const { container } = renderHome(READER);

      const box = container.querySelector('.MuiContainer-maxWidthLg');
      expect(box).toBeInTheDocument();
      expect(box).toHaveClass('MuiContainer-disableGutters');
      await settled();
    });
  });

  describe('Administrator', () => {
    it('loads every panel in parallel, each with its own skeleton first', async () => {
      mockApi();
      renderHome(ADMIN);

      expect(screen.getByLabelText('Loading cards')).toBeInTheDocument();
      expect(screen.getByLabelText('Loading recent secrets')).toBeInTheDocument();
      expect(screen.getByTestId('home-backups-mine').querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByTestId('home-backups-system').querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByTestId('stat-skeleton-secrets')).toBeInTheDocument();
      await settled();
    });

    it('shows the cards needing attention, recent secrets, backups and stats', async () => {
      mockApi({ systemFailed: true });
      renderHome(ADMIN);
      await settled();

      const cardsPanel = screen.getByRole('region', { name: 'Cards needing attention' });
      const cardRows = within(cardsPanel).getAllByRole('link', { name: /Test / });
      expect(cardRows.map((r) => r.textContent)).toEqual([
        expect.stringContaining('Test Visa travel'),
        expect.stringContaining('Test Mastercard'),
      ]);
      expect(within(cardsPanel).queryByText('Test Discover')).not.toBeInTheDocument();

      const recent = screen.getByRole('region', { name: 'Recently updated' });
      expect(within(recent).getAllByRole('link', { name: /Product X|Org Alpha|Staging/ })).toHaveLength(3);

      expect(screen.getByRole('link', { name: 'View Secrets (37)' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View Cards (3)' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View Need attention (2)' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View Media folders (6)' })).toBeInTheDocument();

      const system = screen.getByTestId('home-backups-system');
      expect(within(system).getByText('Last backup failed')).toBeInTheDocument();
      expect(within(system).getByRole('link', { name: 'Open backup settings' })).toBeInTheDocument();
      expect(within(screen.getByTestId('home-backups-mine')).getByText('Last backup succeeded')).toBeInTheDocument();

      const actions = screen.getByRole('navigation', { name: 'Quick actions' });
      expect(within(actions).getAllByRole('link').map((l) => l.textContent)).toEqual([
        'New secret',
        'Scan a card',
        'Back up now',
      ]);
    });

    it('makes exactly one request per source: one card summary replaces a detail request per card', async () => {
      mockApi();
      renderHome(ADMIN);
      await settled();

      expect(countsByPath()).toEqual({
        '/api/secrets': 1, // recent page
        '/api/secrets/cards/summary': 1,
        '/api/backups/me': 1,
        '/api/admin/backups': 1,
        '/api/admin/backups/schedule': 1,
        '/api/media/folders': 1,
        '/api/ai/config': 1,
      });
      // No detail request for any secret, card or not: Home decrypts nothing in the browser.
      expect(requests.some((r) => /^\/api\/secrets\/(?!cards\/summary)[^/?]+/.test(r))).toBe(false);
      expect(requests).toContain('/api/secrets/cards/summary?page=1&pageSize=100');
      // Small pages: the recent list, and a single row for each "latest"/count.
      expect(requests).toContain('/api/secrets?page=1&pageSize=5&sortBy=updatedAt&sortOrder=desc');
      expect(requests).toContain('/api/backups/me?page=1&pageSize=1');
      expect(requests).toContain('/api/admin/backups?page=1&pageSize=1');
      expect(requests).toContain('/api/media/folders?page=1&pageSize=1');
    });
  });

  describe('Permission gating', () => {
    it('never asks for or shows system backups without system_settings:read', async () => {
      mockApi();
      renderHome(WRITER);
      await settled();

      expect(screen.queryByTestId('home-backups-system')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-backups-mine')).toBeInTheDocument();
      expect(requests.some((r) => r.startsWith('/api/admin/'))).toBe(false);
    });

    it('gives a read-only user no create or scan action and never asks for the AI config', async () => {
      mockApi();
      renderHome(READER);
      await settled();

      const actions = screen.getByRole('navigation', { name: 'Quick actions' });
      expect(within(actions).getAllByRole('link').map((l) => l.textContent)).toEqual(['Back up now']);
      expect(countsByPath()['/api/ai/config']).toBeUndefined();
      // Expiring card rows open the detail, not the renew flow.
      expect(screen.getByRole('link', { name: /Test Visa travel/ })).toHaveAttribute('href', '/secrets/c1');
    });

    it('shows no media count and asks for no media without media:read', async () => {
      mockApi();
      renderHome(READER);
      await settled();

      expect(screen.queryByRole('link', { name: /Media folders/ })).not.toBeInTheDocument();
      expect(countsByPath()['/api/media/folders']).toBeUndefined();
    });

    it('hides "Scan a card" when card scanning is off', async () => {
      mockApi({ aiEnabled: false });
      renderHome(WRITER);
      await settled();

      expect(screen.getByRole('link', { name: 'New secret' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Scan a card' })).not.toBeInTheDocument();
    });

    it('fetches nothing and says so for a user without access to secrets, media or settings', async () => {
      mockApi();
      renderHome(NO_ACCESS);

      expect(
        screen.getByText('Nothing to show yet. Ask an administrator for access to secrets or media.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Recently updated' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cards needing attention' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('home-backups')).not.toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Quick actions' })).not.toBeInTheDocument();
      // Give any stray effect a chance to fire before asserting silence.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(countsByPath()).toEqual({});
    });

    it('shows only the system backup panel to an admin without secrets:read', async () => {
      mockApi();
      renderHome(withPerms(['system_settings:read']));
      await settled();

      expect(screen.getByTestId('home-backups-system')).toBeInTheDocument();
      expect(screen.queryByTestId('home-backups-mine')).not.toBeInTheDocument();
      expect(Object.keys(countsByPath()).sort()).toEqual(['/api/admin/backups', '/api/admin/backups/schedule']);
    });
  });

  describe('Independent sources', () => {
    it('keeps the other panels working when one source fails, and retries only that source', async () => {
      mockApi({ failRecent: true });
      const user = userEvent.setup();
      renderHome(WRITER);
      await settled();

      const recent = screen.getByRole('region', { name: 'Recently updated' });
      expect(within(recent).getByRole('alert')).toHaveTextContent('Recent secrets are down');
      expect(screen.getByRole('link', { name: 'View Secrets' })).toHaveTextContent('—');
      // Cards and backups still render their data.
      expect(screen.getByRole('link', { name: /Test Visa travel/ })).toBeInTheDocument();
      expect(screen.getByText('Last backup succeeded')).toBeInTheDocument();

      const before = { ...countsByPath() };
      await user.click(within(recent).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(within(recent).getAllByRole('link', { name: /Product X/ })).toHaveLength(1));

      const after = countsByPath();
      expect(after['/api/secrets']).toBe(before['/api/secrets'] + 1);
      expect(after['/api/secrets/cards/summary']).toBe(before['/api/secrets/cards/summary']);
      expect(after['/api/backups/me']).toBe(before['/api/backups/me']);
    });
  });

  describe('First run', () => {
    it('shows one call to action instead of empty panels and stats', async () => {
      mockApi({ recent: [], recentTotal: 0 });
      renderHome(WRITER);
      await settled();

      const firstRun = screen.getByRole('region', { name: 'Your vault is empty' });
      expect(within(firstRun).getByRole('link', { name: 'Add your first secret' })).toHaveAttribute(
        'href',
        '/secrets/new',
      );
      expect(screen.queryByRole('region', { name: 'Recently updated' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cards needing attention' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('home-stats')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-backups-mine')).toBeInTheDocument();
    });
  });
});
