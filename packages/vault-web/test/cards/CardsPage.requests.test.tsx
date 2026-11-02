import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { render } from '../utils/test-utils.js';
import CardsPage from '../../src/cards/ui/pages/CardsPage.js';
import type { CardSummaryItem } from '../../src/core/headless/types.js';

/**
 * The gallery with the REAL `useCards` hook over MSW (#118): one paged
 * `GET /api/secrets/cards/summary` replaces one `GET /api/secrets/:id` per
 * card. `CardsPage.test.tsx` mocks the hook for the view behaviour.
 */

const NOW = new Date(2026, 10, 2, 10, 0, 0); // 2026-11-02, local

function item(
  id: string,
  name: string,
  last4: string | null,
  expMonth: number | null,
  expYear: number | null,
  extra: Partial<CardSummaryItem> = {},
): CardSummaryItem {
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
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

// Sorted soonest expiry first, unknown last, as the API returns them.
const WALLET = [
  item('c1', 'Test Visa travel', '4242', 10, 2026), // expired
  item('c2', 'Test Mastercard', '4444', 12, 2026, {
    network: 'Mastercard',
    kind: 'Credit',
    issuingBank: 'Org Alpha Bank',
    cardholderName: 'Person A',
    hasPhotos: true,
  }), // expiring soon
  item('c3', 'Test Discover', '1117', 8, 2029), // valid
  item('c4', 'Unreadable card', null, null, null), // malformed: null fields
];

const requests: string[] = [];

function serve(all: CardSummaryItem[]) {
  server.use(
    http.get('*/api/secrets/cards/summary', ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      return HttpResponse.json({
        data: {
          items: all.slice((page - 1) * pageSize, page * pageSize),
          meta: { page, pageSize, totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) },
        },
      });
    }),
    // The gallery must never ask for a card's detail; answer loudly if it does.
    http.get('*/api/secrets/:id', () => new HttpResponse(null, { status: 500 })),
  );
}

const secretsRequests = () => requests.filter((r) => r.startsWith('/api/secret'));

describe('CardsPage requests', () => {
  beforeEach(() => {
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

  it('loads the whole gallery with ONE summary request and no per-card detail request', async () => {
    serve(WALLET);
    render(<CardsPage />);

    expect(await screen.findAllByTestId('card-tile')).toHaveLength(4);
    expect(secretsRequests()).toEqual(['/api/secrets/cards/summary?page=1&pageSize=100']);
  });

  it('shows each card as `•••• last4` with its expiry, soonest first', async () => {
    serve(WALLET);
    render(<CardsPage />);

    const tiles = await screen.findAllByTestId('card-tile');
    expect(tiles.map((t) => t.getAttribute('data-status'))).toEqual(['expired', 'expiring_soon', 'valid', 'unknown']);
    expect(within(tiles[1]).getByText('•••• 4444')).toBeInTheDocument();
    expect(within(tiles[1]).getByText('12/26')).toBeInTheDocument();
    expect(within(tiles[1]).getByText('Mastercard · Credit · Org Alpha Bank')).toBeInTheDocument();
    expect(within(tiles[1]).getByText('Person A')).toBeInTheDocument();
    expect(within(tiles[1]).getByTitle('Has card photos')).toBeInTheDocument();
    expect(screen.getByText(/4 cards — 1 expired, 1 expiring soon\./)).toBeInTheDocument();
  });

  it('renders a card that came back with null fields gracefully', async () => {
    serve(WALLET);
    render(<CardsPage />);

    const tiles = await screen.findAllByTestId('card-tile');
    const broken = tiles[3];
    expect(within(broken).getByText('Unreadable card')).toBeInTheDocument();
    expect(within(broken).getByText('•••• —')).toBeInTheDocument();
    expect(within(broken).getByText('Unknown expiry')).toBeInTheDocument();
    expect(broken.textContent).not.toMatch(/null|undefined|NaN/);
    // Null display fields are omitted, not dashed.
    expect(within(broken).queryByText('Cardholder')).not.toBeInTheDocument();
    expect(within(broken).queryByTitle('Has card photos')).not.toBeInTheDocument();
  });

  it('pages through a wallet larger than one page (pages of 100 until totalPages)', async () => {
    const big = Array.from({ length: 150 }, (_, i) =>
      item(`b${i}`, `Test card ${i}`, String(1000 + i), 1, 2030),
    );
    serve(big);
    render(<CardsPage />);

    await waitFor(() => expect(screen.getAllByTestId('card-tile')).toHaveLength(150));
    expect(secretsRequests()).toEqual([
      '/api/secrets/cards/summary?page=1&pageSize=100',
      '/api/secrets/cards/summary?page=2&pageSize=100',
    ]);
  });
});
