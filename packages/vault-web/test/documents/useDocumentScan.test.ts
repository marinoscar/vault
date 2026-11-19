// Issue #211: the document scan hook — extraction to review values, save,
// orphan cleanup and unmount cleanup. Invented values only.
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultDocumentName,
  documentAiSeededFields,
  documentScanSlots,
  parseDocumentScanType,
  toDocumentReviewValues,
  useDocumentScan,
  type CapturedDocumentImage,
} from '../../src/documents/headless/useDocumentScan.js';
import { ApiError } from '../../src/core/headless/api.js';
import { DOCUMENT_SCAN_SUBJECT, describeScanError } from '../../src/core/headless/scanErrors.js';
import { AI_ERROR_CODES } from '../../src/core/headless/types.js';
import type { CroppedCardImage } from '../../src/cards/headless/cardImage.js';
import { server } from '../mocks/server.js';
import { ID_DOCUMENT_TYPE, ID_EXTRACTION, PASSPORT_EXTRACTION, PASSPORT_TYPE } from './documentFixtures.js';

const API_BASE = '*/api';

// The PDF417 decoder (issue #214) is mocked; it is lazy-loaded by the barcode reader.
const decodePdf417Image = vi.hoisted(() => vi.fn<(file: Blob) => Promise<string | null>>());
vi.mock('../../src/documents/headless/pdf417Decoder.js', () => ({ decodePdf417Image }));

function image(role: string): CroppedCardImage {
  return {
    dataUrl: 'data:image/jpeg;base64,AAAA',
    file: new File(['bytes'], `doc-${role}.jpg`, { type: 'image/jpeg' }),
    previewUrl: `blob:${role}`,
    width: 1250,
    height: 880,
  };
}

function recordRequests() {
  const seen: string[] = [];
  server.events.removeAllListeners('request:start');
  server.events.on('request:start', ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return seen;
}

const typesHandler = () =>
  http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [PASSPORT_TYPE, ID_DOCUMENT_TYPE] }));

beforeEach(() => {
  server.events.removeAllListeners('request:start');
});

describe('document scan helpers', () => {
  it('reads the ?type= value, defaulting to an ID document', () => {
    expect(parseDocumentScanType('passport')).toBe('passport');
    expect(parseDocumentScanType('id_document')).toBe('id_document');
    expect(parseDocumentScanType(null)).toBe('id_document');
    expect(parseDocumentScanType('card')).toBe('id_document');
  });

  it('captures the type slots in order', () => {
    expect(documentScanSlots('passport').map((s) => s.role)).toEqual(['data_page', 'back']);
    expect(documentScanSlots('id_document').map((s) => s.role)).toEqual(['front', 'back']);
    expect(documentScanSlots('passport')[0].aspectRatio).toBeCloseTo(125 / 88);
  });

  it('seeds typed fields, the guessed kind and the attributes with their confidence', () => {
    const seed = toDocumentReviewValues(ID_EXTRACTION);
    expect(seed.values).toMatchObject({
      holder_name: 'PERSON A EXAMPLE',
      document_kind: 'Driver License',
      expiry_date: '2030-02-02',
    });
    expect(seed.values).not.toHaveProperty('notes');
    expect(seed.values.attributes).toEqual([
      { key: 'license_class', label: 'Class', value: 'C', sensitive: false },
      { key: 'restrictions', label: 'Restrictions', value: 'NONE', sensitive: false },
    ]);
    expect(seed.attributeConfidence).toEqual({ license_class: 0.95, restrictions: 0.4 });
    expect(documentAiSeededFields(ID_EXTRACTION).has('document_kind')).toBe(true);
    expect(toDocumentReviewValues(null)).toEqual({ values: {}, attributeConfidence: {} });
  });

  it('builds the default name without a document number', () => {
    expect(buildDefaultDocumentName('id_document', toDocumentReviewValues(ID_EXTRACTION).values)).toBe(
      'Driver License · PERSON',
    );
    expect(buildDefaultDocumentName('id_document', {})).toBe('ID document');
    expect(buildDefaultDocumentName('passport', { issuing_country: 'UTO' })).toMatch(/^Passport · /);
    expect(buildDefaultDocumentName('passport', {})).toBe('Passport');
    expect(buildDefaultDocumentName('passport', toDocumentReviewValues(PASSPORT_EXTRACTION).values)).not.toMatch(
      /X0000000/,
    );
  });

  it('words scan errors for a document', () => {
    const quota = describeScanError(new ApiError('x', 429, AI_ERROR_CODES.QUOTA_EXCEEDED), DOCUMENT_SCAN_SUBJECT);
    expect(quota.detail).toMatch(/document scan allowance/);
    const forbidden = describeScanError(new ApiError('x', 403, 'FORBIDDEN'), DOCUMENT_SCAN_SUBJECT);
    expect(forbidden.title).toBe('Document scanning is not available to you');
  });
});

describe('useDocumentScan', () => {
  it('runs the extraction for the current type and keeps the result', async () => {
    let body: unknown = null;
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets/documents/extract`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: PASSPORT_EXTRACTION });
      }),
    );
    const { result } = renderHook(() => useDocumentScan('passport'));
    await waitFor(() => expect(result.current.secretType?.id).toBe('type-passport'));

    const out = await act(() => result.current.runExtraction({ data_page: 'data:image/jpeg;base64,AAAA' }));
    expect(body).toEqual({ documentType: 'passport', images: { data_page: 'data:image/jpeg;base64,AAAA' } });
    expect(out?.fields.surname).toBe('EXAMPLE');
    expect(result.current.extraction?.documentType).toBe('passport');
  });

  it('decodes the back barcode of an ID document only, and flags a barcode it could not read (issue #214)', async () => {
    const bodies: unknown[] = [];
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets/documents/extract`, async ({ request }) => {
        const body = (await request.json()) as { documentType: string };
        bodies.push(body);
        return HttpResponse.json({
          data: body.documentType === 'passport' ? PASSPORT_EXTRACTION : { ...ID_EXTRACTION, barcodePresent: true },
        });
      }),
    );
    const back = new File(['back'], 'back.jpg', { type: 'image/jpeg' });
    decodePdf417Image.mockResolvedValue(null);

    const { result } = renderHook(() => useDocumentScan('id_document'));
    await act(() => result.current.runExtraction({ front: 'data:image/jpeg;base64,AAAA' }));
    expect(result.current.barcodeOutcome).toBe('skipped');
    expect(result.current.barcodeUnread).toBe(false);
    expect(decodePdf417Image).not.toHaveBeenCalled();

    await act(() => result.current.runExtraction({ front: 'data:image/jpeg;base64,AAAA' }, { backPhoto: back }));
    expect(decodePdf417Image).toHaveBeenCalledWith(back);
    expect(result.current.barcodeOutcome).toBe('failed');
    expect(result.current.barcodeUnread).toBe(true);
    expect(bodies.at(-1)).not.toHaveProperty('barcode');

    const passport = renderHook(() => useDocumentScan('passport'));
    decodePdf417Image.mockClear();
    await act(() => passport.result.current.runExtraction({ data_page: 'data:image/jpeg;base64,AAAA' }, { backPhoto: back }));
    expect(decodePdf417Image).not.toHaveBeenCalled();
    expect(passport.result.current.barcodeOutcome).toBe('skipped');
  });

  it('resolves a failed extraction to null with a worded error', async () => {
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets/documents/extract`, () =>
        HttpResponse.json({ message: 'x', code: AI_ERROR_CODES.EXTRACTION_FAILED }, { status: 422 }),
      ),
    );
    const { result } = renderHook(() => useDocumentScan());
    const out = await act(() => result.current.runExtraction({ front: 'data:image/jpeg;base64,AAAA' }));
    expect(out).toBeNull();
    expect(result.current.extractionError?.title).toBe('The document could not be read');
  });

  it('saves the secret, uploads each slot and links it with its role', async () => {
    const linked: unknown[] = [];
    let created: { typeId: string; data: Record<string, unknown> } | null = null;
    let objects = 0;
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets`, async ({ request }) => {
        created = (await request.json()) as typeof created;
        return HttpResponse.json({ data: { id: 'secret-1' } });
      }),
      http.post(`${API_BASE}/storage/objects`, () => HttpResponse.json({ data: { id: `object-${++objects}` } })),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        linked.push(await request.json());
        return HttpResponse.json({ data: { id: 'attachment' } });
      }),
    );

    const { result } = renderHook(() => useDocumentScan('id_document'));
    await waitFor(() => expect(result.current.secretType?.id).toBe('type-id-document'));
    const images: CapturedDocumentImage[] = [
      { role: 'front', image: image('front') },
      { role: 'back', image: image('back') },
    ];
    const outcome = await act(() =>
      result.current.saveDocument({
        name: 'Driver License · PERSON',
        values: { ...toDocumentReviewValues(ID_EXTRACTION).values, notes: '  ' },
        images,
      }),
    );

    expect(outcome).toEqual({ secretId: 'secret-1', attachmentWarning: null });
    expect(created!.typeId).toBe('type-id-document');
    expect(created!.data).toMatchObject({ document_kind: 'Driver License', holder_name: 'PERSON A EXAMPLE' });
    expect(created!.data).not.toHaveProperty('notes');
    expect((created!.data.attributes as unknown[]).length).toBe(2);
    expect(linked).toEqual([
      { storageObjectId: 'object-1', label: 'doc-front.jpg', role: 'front' },
      { storageObjectId: 'object-2', label: 'doc-back.jpg', role: 'back' },
    ]);
  });

  it('links a passport data page under data_page', async () => {
    const roles: string[] = [];
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets`, () => HttpResponse.json({ data: { id: 'secret-2' } })),
      http.post(`${API_BASE}/storage/objects`, () => HttpResponse.json({ data: { id: 'object-1' } })),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        roles.push(((await request.json()) as { role: string }).role);
        return HttpResponse.json({ data: { id: 'attachment' } });
      }),
    );
    const { result } = renderHook(() => useDocumentScan('passport'));
    await waitFor(() => expect(result.current.secretType).not.toBeNull());
    await act(() =>
      result.current.saveDocument({
        name: 'Passport · Utopia',
        values: toDocumentReviewValues(PASSPORT_EXTRACTION).values,
        images: [{ role: 'data_page', image: image('data_page') }],
      }),
    );
    expect(roles).toEqual(['data_page']);
  });

  it('keeps the secret with a warning and deletes the orphan when a link fails', async () => {
    const seen = recordRequests();
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets`, () => HttpResponse.json({ data: { id: 'secret-1' } })),
      http.post(`${API_BASE}/storage/objects`, () => HttpResponse.json({ data: { id: 'object-1' } })),
      http.post(`${API_BASE}/secrets/:id/attachments`, () => HttpResponse.json({ message: 'nope' }, { status: 400 })),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result } = renderHook(() => useDocumentScan('passport'));
    await waitFor(() => expect(result.current.secretType).not.toBeNull());
    const outcome = await act(() =>
      result.current.saveDocument({
        name: 'Passport',
        values: toDocumentReviewValues(PASSPORT_EXTRACTION).values,
        images: [{ role: 'data_page', image: image('data_page') }],
      }),
    );
    expect(outcome?.secretId).toBe('secret-1');
    expect(outcome?.attachmentWarning).toMatch(/data page photo could not be attached/);
    expect(seen).toContain('DELETE /api/storage/objects/object-1');
    expect(seen).not.toContain('DELETE /api/secrets/secret-1');
  });

  it('cleans up the half-made secret and upload on unmount', async () => {
    const seen = recordRequests();
    server.use(
      typesHandler(),
      http.post(`${API_BASE}/secrets`, () => HttpResponse.json({ data: { id: 'secret-1' } })),
      http.post(`${API_BASE}/storage/objects`, () => HttpResponse.json({ data: { id: 'object-1' } })),
      http.post(`${API_BASE}/secrets/:id/attachments`, async () => {
        await delay('infinite');
        return HttpResponse.json({ data: {} });
      }),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${API_BASE}/secrets/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result, unmount } = renderHook(() => useDocumentScan('passport'));
    await waitFor(() => expect(result.current.secretType).not.toBeNull());

    act(() => {
      void result.current.saveDocument({
        name: 'Passport',
        values: toDocumentReviewValues(PASSPORT_EXTRACTION).values,
        images: [{ role: 'data_page', image: image('data_page') }],
      });
    });
    await waitFor(() => expect(seen.some((r) => r.startsWith('POST /api/secrets/secret-1/attachments'))).toBe(true));

    unmount();
    await waitFor(() => {
      expect(seen).toContain('DELETE /api/storage/objects/object-1');
      expect(seen).toContain('DELETE /api/secrets/secret-1');
    });
  });
});
