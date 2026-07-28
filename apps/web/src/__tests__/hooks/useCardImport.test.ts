import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../../services/api';
import {
  buildDefaultCardName,
  describeCardExtractionError,
  toReviewValues,
  useCardImport,
  type CapturedCardSide,
} from '../../hooks/useCardImport';
import { AI_ERROR_CODES, type CardExtractionResult } from '../../types';
import type { CroppedCardImage } from '../../utils/cardImage';
import { server } from '../mocks/server';

const API_BASE = '*/api';

const CARD_TYPE = {
  id: 'card-type-id',
  name: 'Card',
  description: 'Credit or debit card information',
  icon: 'CreditCard',
  isSystem: true,
  allowAttachments: true,
  createdAt: new Date().toISOString(),
  fields: [
    { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
    { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
    { name: 'cvv', label: 'CVV / CVC', type: 'string', required: true, sensitive: true },
  ],
};

function croppedImage(side: 'front' | 'back'): CroppedCardImage {
  return {
    dataUrl: `data:image/jpeg;base64,${side === 'front' ? 'AAAA' : 'BBBB'}`,
    file: new File(['bytes'], `card-${side}.jpg`, { type: 'image/jpeg' }),
    previewUrl: `blob:preview-${side}`,
    width: 1400,
    height: 883,
  };
}

const FRONT: CapturedCardSide = { role: 'card_front', image: croppedImage('front') };

/** Records every request the hook makes, so cleanup can be asserted on. */
function recordRequests() {
  const seen: string[] = [];
  server.events.removeAllListeners('request:start');
  server.events.on('request:start', ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return seen;
}

function secretTypesHandler() {
  return http.get(`${API_BASE}/secret-types`, () =>
    HttpResponse.json({ data: [CARD_TYPE] }),
  );
}

describe('describeCardExtractionError', () => {
  it('distinguishes the daily quota from the burst limit when codes survive', () => {
    const quota = describeCardExtractionError(
      new ApiError('nope', 429, AI_ERROR_CODES.QUOTA_EXCEEDED),
    );
    const burst = describeCardExtractionError(
      new ApiError('nope', 429, AI_ERROR_CODES.RATE_LIMITED),
    );

    expect(quota.title).toMatch(/daily/i);
    expect(quota.detail).toMatch(/tomorrow/i);
    expect(quota.retryable).toBe(false);

    expect(burst.title).not.toMatch(/daily/i);
    expect(burst.detail).toMatch(/shortly/i);
    expect(burst.retryable).toBe(true);

    expect(quota.detail).not.toBe(burst.detail);
  });

  it('gives every AI error code its own message', () => {
    const messages = Object.values(AI_ERROR_CODES).map(
      (code) => describeCardExtractionError(new ApiError('x', 500, code)).detail,
    );

    expect(new Set(messages).size).toBe(messages.length);
  });

  it('flags the codes only an administrator can clear', () => {
    for (const code of [
      AI_ERROR_CODES.NOT_CONFIGURED,
      AI_ERROR_CODES.KEY_UNREADABLE,
      AI_ERROR_CODES.UPSTREAM_AUTH,
    ]) {
      expect(
        describeCardExtractionError(new ApiError('x', 503, code)).adminActionRequired,
      ).toBe(true);
    }

    expect(
      describeCardExtractionError(
        new ApiError('x', 422, AI_ERROR_CODES.EXTRACTION_FAILED),
      ).adminActionRequired,
    ).toBe(false);
  });

  it('falls back to the status when the filter has clobbered the code (issue #35)', () => {
    // What the API actually sends today: the global HttpExceptionFilter
    // overwrites `code` with a status-derived string.
    const clobbered = describeCardExtractionError(
      new ApiError('Too many requests', 429, 'TOO_MANY_REQUESTS'),
    );

    // Covers both limits honestly rather than guessing at one.
    expect(clobbered.title).toMatch(/limit/i);
    expect(clobbered.detail).toMatch(/short period/i);
    expect(clobbered.detail).toMatch(/daily/i);
  });

  it('maps every clobbered status to something actionable', () => {
    expect(
      describeCardExtractionError(new ApiError('x', 503, 'ERROR')).adminActionRequired,
    ).toBe(true);
    expect(
      describeCardExtractionError(new ApiError('x', 422, 'UNPROCESSABLE_ENTITY')).title,
    ).toMatch(/could not be read/i);
    expect(
      describeCardExtractionError(new ApiError('x', 400, 'BAD_REQUEST')).title,
    ).toMatch(/could not be sent/i);
    expect(
      describeCardExtractionError(new ApiError('x', 502, 'ERROR')).title,
    ).toMatch(/unavailable/i);
  });

  it('never derives a branch from the message text', () => {
    // Same status, wildly different wording: the outcome must not move.
    const a = describeCardExtractionError(new ApiError('Daily limit', 429, 'TOO_MANY_REQUESTS'));
    const b = describeCardExtractionError(new ApiError('Slow down', 429, 'TOO_MANY_REQUESTS'));

    expect(a).toEqual(b);
  });

  it('handles a plain network error', () => {
    const message = describeCardExtractionError(new TypeError('Failed to fetch'));

    expect(message.title).toBeTruthy();
    expect(message.detail).toBeTruthy();
  });
});

describe('toReviewValues', () => {
  it('never seeds a CVV, even if one somehow appears in the response', () => {
    const extraction = {
      fields: { number: '4242424242424242', cvv: '123' },
      confidence: {},
      warnings: [],
      model: 'gpt-4o-mini',
      partial: false,
    } as unknown as CardExtractionResult;

    expect(toReviewValues(extraction).cvv).toBe('');
    expect(toReviewValues(extraction).number).toBe('4242424242424242');
  });

  it('produces an all-empty form when there is no extraction', () => {
    const values = toReviewValues(null);

    expect(values.cvv).toBe('');
    expect(values.number).toBe('');
    expect(values.cardholder_name).toBe('');
  });

  it('seeds Notes from the extraction, like any other extracted field', () => {
    const extraction = {
      fields: { notes: 'Member since 2019 — support: +1 555 0100' },
      confidence: {},
      warnings: [],
      model: 'gpt-4o-mini',
      partial: false,
    } as unknown as CardExtractionResult;

    expect(toReviewValues(extraction).notes).toBe(
      'Member since 2019 — support: +1 555 0100',
    );
  });

  it('leaves Notes empty when the extraction did not return one', () => {
    const extraction = {
      fields: { number: '4242424242424242' },
      confidence: {},
      warnings: [],
      model: 'gpt-4o-mini',
      partial: false,
    } as unknown as CardExtractionResult;

    expect(toReviewValues(extraction).notes).toBe('');
  });
});

describe('buildDefaultCardName', () => {
  it('uses the network and the last four digits', () => {
    expect(buildDefaultCardName('Visa', '4242 4242 4242 4242')).toBe('Visa ••••4242');
  });

  it('falls back when the network is unknown', () => {
    expect(buildDefaultCardName(null, '4111111111111111')).toBe('Card ••••1111');
    expect(buildDefaultCardName('', '')).toBe('Imported card');
    expect(buildDefaultCardName('Amex', null)).toBe('Amex');
  });

  it('never puts a full card number in the name', () => {
    expect(buildDefaultCardName('Visa', '4242424242424242')).not.toContain(
      '4242424242424242',
    );
  });
});

describe('useCardImport save and cleanup', () => {
  beforeEach(() => {
    server.events.removeAllListeners('request:start');
  });

  it('creates the secret, uploads each side and links it with a role', async () => {
    const linked: { storageObjectId: string; role: string }[] = [];
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-1' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1', name: 'card-front.jpg' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        linked.push((await request.json()) as { storageObjectId: string; role: string });
        return HttpResponse.json({ data: { id: 'attachment-1' } });
      }),
    );

    const { result } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    const outcome = await act(() =>
      result.current.saveCard({
        name: 'Visa ••••4242',
        values: { cvv: '123', number: '4242424242424242' },
        images: [FRONT],
      }),
    );

    expect(outcome).toEqual({ secretId: 'secret-1', attachmentWarning: null });
    expect(linked).toEqual([
      { storageObjectId: 'object-1', role: 'card_front', label: 'card-front.jpg' },
    ]);
  });

  it('deletes an uploaded image it could not link, and keeps the saved card', async () => {
    const seen = recordRequests();
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-1' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
    );

    const { result } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    const outcome = await act(() =>
      result.current.saveCard({
        name: 'Visa ••••4242',
        values: { cvv: '123' },
        images: [FRONT],
      }),
    );

    // The typed card details are worth more than the photo, so the secret stays.
    expect(outcome?.secretId).toBe('secret-1');
    expect(outcome?.attachmentWarning).toMatch(/front/i);
    expect(seen).toContain('DELETE /api/storage/objects/object-1');
    expect(seen).not.toContain('DELETE /api/secrets/secret-1');
  });

  it('leaves nothing behind when the secret itself cannot be created', async () => {
    const seen = recordRequests();
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ message: 'Validation failed' }, { status: 400 }),
      ),
    );

    const { result } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    await act(async () => {
      await result.current.saveCard({
        name: 'Visa',
        values: { cvv: '123' },
        images: [FRONT],
      });
    });

    expect(result.current.saveError).toBe('Validation failed');
    expect(seen.filter((entry) => entry.startsWith('POST /api/storage'))).toHaveLength(0);
    expect(seen.filter((entry) => entry.startsWith('DELETE'))).toHaveLength(0);
  });

  it('abandoning mid-save deletes the uploaded image and the half-made secret', async () => {
    const seen = recordRequests();
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-1' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      // Stalls forever: stands in for the user hitting Cancel while an
      // attachment link is still in flight.
      http.post(`${API_BASE}/secrets/:id/attachments`, async () => {
        await delay('infinite');
        return HttpResponse.json({ data: {} });
      }),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${API_BASE}/secrets/:id`, () => new HttpResponse(null, { status: 204 })),
    );

    const { result } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    act(() => {
      void result.current.saveCard({
        name: 'Visa',
        values: { cvv: '123' },
        images: [FRONT],
      });
    });

    await waitFor(() => expect(seen).toContain('POST /api/storage/objects'));

    await act(async () => {
      await result.current.abandonImport();
    });

    expect(seen).toContain('DELETE /api/storage/objects/object-1');
    expect(seen).toContain('DELETE /api/secrets/secret-1');
  });

  it('does not delete the card after a clean save', async () => {
    const seen = recordRequests();
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-1' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, () =>
        HttpResponse.json({ data: { id: 'attachment-1' } }),
      ),
    );

    const { result, unmount } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    await act(async () => {
      await result.current.saveCard({
        name: 'Visa',
        values: { cvv: '123' },
        images: [FRONT],
      });
    });

    // Navigating away after a successful save unmounts the hook; the cleanup
    // must not treat the committed secret as an orphan.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen.filter((entry) => entry.startsWith('DELETE'))).toHaveLength(0);
  });

  it('resolves an extraction failure instead of rejecting', async () => {
    server.use(
      secretTypesHandler(),
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json(
          { message: 'nope', code: 'UNPROCESSABLE_ENTITY' },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useCardImport());
    await waitFor(() => expect(result.current.cardType).not.toBeNull());

    let extracted: CardExtractionResult | null = { partial: false } as CardExtractionResult;
    await act(async () => {
      extracted = await result.current.runExtraction([FRONT]);
    });

    expect(extracted).toBeNull();
    expect(result.current.extractionError?.title).toMatch(/could not be read/i);
  });
});
