import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCards, toCardSummary } from '../../hooks/useCards';
import { server } from '../mocks/server';
import type { SecretDetail, SecretType } from '../../types';

const API_BASE = '*/api';

const cardType: SecretType = {
  id: 'type-card',
  name: 'Card',
  description: 'Credit or debit card information',
  icon: 'CreditCard',
  fields: [],
  allowAttachments: true,
  isSystem: true,
  createdAt: new Date('2024-01-01').toISOString(),
};

const loginType: SecretType = {
  ...cardType,
  id: 'type-login',
  name: 'Login',
  icon: 'VpnKey',
};

function makeCard(overrides: {
  id: string;
  name?: string;
  values?: Record<string, unknown>;
  attachments?: SecretDetail['attachments'];
}): SecretDetail {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: null,
    type: cardType,
    currentVersion: 1,
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-01-02').toISOString(),
    values: overrides.values ?? {},
    createdBy: null,
    attachments: overrides.attachments ?? [],
  };
}

/** Wire up the three calls the hook makes: types, list, then per-card detail. */
function mockApi(cards: SecretDetail[], options?: { totalItems?: number; types?: SecretType[] }) {
  server.use(
    http.get(`${API_BASE}/secret-types`, () =>
      HttpResponse.json({ data: options?.types ?? [loginType, cardType] }),
    ),
    http.get(`${API_BASE}/secrets`, () =>
      HttpResponse.json({
        data: {
          items: cards.map((card) => ({
            id: card.id,
            name: card.name,
            description: card.description,
            type: card.type,
            currentVersion: card.currentVersion,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
          })),
          meta: {
            page: 1,
            pageSize: 100,
            totalItems: options?.totalItems ?? cards.length,
            totalPages: 1,
          },
        },
      }),
    ),
    http.get(`${API_BASE}/secrets/:id`, ({ params }) => {
      const card = cards.find((c) => c.id === params.id);
      if (!card) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json({ data: card });
    }),
  );
}

describe('toCardSummary', () => {
  const NOW = new Date(2026, 6, 15); // 2026-07-15, local

  it('flattens a full card into display strings', () => {
    const summary = toCardSummary(
      makeCard({
        id: 'card-1',
        name: 'Personal Visa',
        values: {
          card_network: 'Visa',
          card_kind: 'Credit',
          cardholder_name: 'Ada Lovelace',
          issuing_bank: 'Analytical Bank',
          number: '4242424242424242',
          exp_month: '12',
          exp_year: '2026',
        },
      }),
      NOW,
    );

    expect(summary.network).toBe('Visa');
    expect(summary.kind).toBe('Credit');
    expect(summary.cardholderName).toBe('Ada Lovelace');
    expect(summary.issuingBank).toBe('Analytical Bank');
    expect(summary.expiryLabel).toBe('12/26');
    expect(summary.status).toBe('valid');
  });

  it('masks the number and never exposes the full PAN', () => {
    const summary = toCardSummary(
      makeCard({ id: 'card-1', values: { number: '4242424242424242' } }),
      NOW,
    );

    expect(summary.maskedNumber).toBe('•••• •••• •••• 4242');
    expect(summary.maskedNumber).not.toContain('424242424242');
    expect(JSON.stringify(summary)).not.toContain('4242424242424242');
  });

  it('renders a pre-#24 card without card_network / card_kind', () => {
    const summary = toCardSummary(
      makeCard({
        id: 'legacy',
        name: 'Old Card',
        values: { cardholder_name: 'Grace Hopper', number: '5555444433332222' },
      }),
      NOW,
    );

    expect(summary.network).toBe('');
    expect(summary.kind).toBe('');
    expect(summary.cardholderName).toBe('Grace Hopper');
    expect(summary.status).toBe('unknown');
    expect(summary.expiryLabel).toBe('');
  });

  it('survives a card with no values at all', () => {
    const summary = toCardSummary(makeCard({ id: 'empty' }), NOW);
    expect(summary.status).toBe('unknown');
    expect(summary.maskedNumber).toBe('');
    expect(summary.cardholderName).toBe('');
  });

  it('marks a card that expired last month as expired', () => {
    const summary = toCardSummary(
      makeCard({ id: 'gone', values: { exp_month: '06', exp_year: '2026' } }),
      NOW,
    );
    expect(summary.status).toBe('expired');
  });

  it('reports attachment presence', () => {
    const withAttachment = toCardSummary(
      makeCard({
        id: 'with',
        attachments: [
          {
            id: 'att-1',
            label: 'front',
            storageObject: { id: 'obj-1', name: 'front.jpg', mimeType: 'image/jpeg', size: 100 },
            createdAt: new Date('2024-01-01').toISOString(),
          },
        ],
      }),
      NOW,
    );
    expect(withAttachment.hasAttachments).toBe(true);
    expect(toCardSummary(makeCard({ id: 'without' }), NOW).hasAttachments).toBe(false);
  });
});

describe('useCards', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('loads only cards of the system Card type', async () => {
    mockApi([
      makeCard({ id: 'card-1', values: { exp_month: '01', exp_year: '2030' } }),
      makeCard({ id: 'card-2', values: { exp_month: '02', exp_year: '2030' } }),
    ]);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: new Date(2026, 6, 15) });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('sorts cards by expiry, soonest first, with unknown expiries last', async () => {
    mockApi([
      makeCard({ id: 'later', values: { exp_month: '12', exp_year: '2029' } }),
      makeCard({ id: 'unknown', values: { exp_month: '13', exp_year: '2029' } }),
      makeCard({ id: 'soonest', values: { exp_month: '01', exp_year: '2027' } }),
    ]);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: new Date(2026, 6, 15) });
    });

    await waitFor(() => expect(result.current.cards).toHaveLength(3));
    expect(result.current.cards.map((c) => c.id)).toEqual(['soonest', 'later', 'unknown']);
  });

  it('returns no cards when the Card system type does not exist', async () => {
    mockApi([], { types: [loginType] });

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards).toEqual([]);
  });

  it('drops a card whose detail fetch fails rather than failing the view', async () => {
    const good = makeCard({ id: 'good', values: { exp_month: '01', exp_year: '2030' } });
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [cardType] })),
      http.get(`${API_BASE}/secrets`, () =>
        HttpResponse.json({
          data: {
            items: [
              { ...good, values: undefined },
              { ...good, id: 'broken' },
            ],
            meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
          },
        }),
      ),
      http.get(`${API_BASE}/secrets/:id`, ({ params }) =>
        params.id === 'good'
          ? HttpResponse.json({ data: good })
          : new HttpResponse(null, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards.map((c) => c.id)).toEqual(['good']);
    expect(result.current.error).toBeNull();
  });

  it('flags truncation when the API holds more cards than were loaded', async () => {
    mockApi([makeCard({ id: 'card-1' })], { totalItems: 250 });

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isTruncated).toBe(true);
    expect(result.current.totalItems).toBe(250);
  });

  it('surfaces an error when the list request fails', async () => {
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [cardType] })),
      http.get(`${API_BASE}/secrets`, () => new HttpResponse(null, { status: 500 })),
    );

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.cards).toEqual([]);
  });
});
