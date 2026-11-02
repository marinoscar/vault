import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCards, toCardSummary, CARD_SUMMARY_PAGE_SIZE } from '../../hooks/useCards';
import { server } from '../mocks/server';
import type { CardSummaryItem } from '../../types';

const API_BASE = '*/api';
const NOW = new Date(2026, 6, 15); // 2026-07-15, local

function item(
  id: string,
  expMonth: number | null,
  expYear: number | null,
  last4: string | null = '4242',
): CardSummaryItem {
  return { id, name: `Card ${id}`, last4, expMonth, expYear, updatedAt: '2026-01-02T00:00:00.000Z' };
}

/**
 * Serve `all` (already sorted, as the API does) in pages, and record every
 * request so tests can count them.
 */
const requests: string[] = [];
function mockSummary(all: CardSummaryItem[]) {
  server.use(
    http.get(`${API_BASE}/secrets/cards/summary`, ({ request }) => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      const items = all.slice((page - 1) * pageSize, page * pageSize);
      return HttpResponse.json({
        data: {
          items,
          meta: { page, pageSize, totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) },
        },
      });
    }),
  );
}

describe('toCardSummary', () => {
  it('flattens a summary row into display strings', () => {
    const summary = toCardSummary(item('a', 12, 2026), NOW);

    expect(summary.name).toBe('Card a');
    expect(summary.last4).toBe('4242');
    expect(summary.maskedNumber).toBe('•••• 4242');
    expect(summary.expiryLabel).toBe('12/26');
    expect(summary.status).toBe('valid');
  });

  it('classifies an expired and an expiring card', () => {
    expect(toCardSummary(item('gone', 6, 2026), NOW).status).toBe('expired');
    expect(toCardSummary(item('soon', 8, 2026), NOW).status).toBe('expiring_soon');
  });

  it('survives a malformed card that came back with null fields', () => {
    const summary = toCardSummary(item('broken', null, null, null), NOW);

    expect(summary.last4).toBeNull();
    expect(summary.maskedNumber).toBe('');
    expect(summary.expiryLabel).toBe('');
    expect(summary.status).toBe('unknown');
    expect(summary.expirySortKey).toBe(Number.POSITIVE_INFINITY);
  });

  it('treats a year without a month as unknown', () => {
    const summary = toCardSummary(item('half', null, 2027), NOW);
    expect(summary.status).toBe('unknown');
    expect(summary.expiryLabel).toBe('');
  });

  it('ignores a last4 that is not four digits', () => {
    expect(toCardSummary(item('odd', 1, 2030, '42424242'), NOW).maskedNumber).toBe('');
  });
});

describe('useCards', () => {
  beforeEach(() => {
    server.resetHandlers();
    requests.length = 0;
  });
  afterEach(() => {
    requests.length = 0;
  });

  it('loads every card from ONE summary request and never asks for a card detail', async () => {
    const details: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (/\/api\/secrets\/(?!cards\/summary)[^/?]+$/.test(new URL(request.url).pathname)) {
        details.push(request.url);
      }
    });
    mockSummary([item('a', 1, 2027), item('b', 2, 2030), item('c', null, null, null)]);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: NOW });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.totalItems).toBe(3);
    expect(result.current.error).toBeNull();
    expect(requests).toEqual([`/api/secrets/cards/summary?page=1&pageSize=${CARD_SUMMARY_PAGE_SIZE}`]);
    expect(details).toEqual([]);
    server.events.removeAllListeners('request:start');
  });

  it('pages through every page of 100 for the gallery', async () => {
    const all = Array.from({ length: 230 }, (_, i) => item(`c${i}`, 1, 2030 + Math.floor(i / 12)));
    mockSummary(all);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: NOW });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards).toHaveLength(230);
    expect(result.current.isTruncated).toBe(false);
    expect(requests).toEqual([
      '/api/secrets/cards/summary?page=1&pageSize=100',
      '/api/secrets/cards/summary?page=2&pageSize=100',
      '/api/secrets/cards/summary?page=3&pageSize=100',
    ]);
  });

  it('stops after the first page once the attention window is passed (Home)', async () => {
    const all = [
      item('expired', 5, 2026),
      item('soon', 8, 2026),
      ...Array.from({ length: 150 }, (_, i) => item(`v${i}`, 1, 2030)),
    ];
    mockSummary(all);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: NOW, scope: 'attention' });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(requests).toHaveLength(1);
    expect(result.current.totalItems).toBe(152);
    expect(result.current.cards.filter((c) => c.status !== 'valid').map((c) => c.id)).toEqual(['expired', 'soon']);
    expect(result.current.isTruncated).toBe(false);
  });

  it('keeps paging on Home while a whole page still needs attention', async () => {
    const all = [
      ...Array.from({ length: 100 }, (_, i) => item(`x${i}`, 1, 2025)), // expired
      item('soon', 8, 2026),
      item('ok', 1, 2030),
    ];
    mockSummary(all);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards({ now: NOW, scope: 'attention' });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(requests).toHaveLength(2);
    expect(result.current.cards.some((c) => c.id === 'soon')).toBe(true);
  });

  it('returns an empty wallet without error', async () => {
    mockSummary([]);

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it('surfaces an error when the summary request fails', async () => {
    server.use(http.get(`${API_BASE}/secrets/cards/summary`, () => new HttpResponse(null, { status: 500 })));

    const { result } = renderHook(() => useCards());
    await act(async () => {
      await result.current.fetchCards();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.cards).toEqual([]);
  });
});
