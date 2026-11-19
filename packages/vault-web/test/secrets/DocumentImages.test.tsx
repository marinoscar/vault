import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { render } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import {
  DocumentImages,
  documentImageSlotsFor,
  supportsDocumentImages,
} from '../../src/secrets/ui/components/DocumentImages.js';
import { SECRET_REVEAL_TIMEOUT_MS } from '../../src/secrets/headless/secretFields.js';
import type { SecretAttachment, SecretType } from '../../src/core/headless/types.js';

const API_BASE = '*/api';
const SECRET_ID = 'secret-1';

function attachment(overrides: Partial<SecretAttachment> = {}): SecretAttachment {
  return {
    id: 'att-data',
    label: 'data-page.jpg',
    role: 'data_page',
    storageObject: { id: 'obj-data', name: 'data-page.jpg', mimeType: 'image/jpeg', size: 1024 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function systemType(name: string, overrides: Partial<SecretType> = {}): SecretType {
  return {
    id: `type-${name}`,
    name,
    description: null,
    icon: null,
    fields: [],
    allowAttachments: true,
    isSystem: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Built here: the Passport and ID Document system types arrive with IDOC-6.
const CARD = systemType('Card');
const PASSPORT = systemType('Passport');
const ID_DOCUMENT = systemType('ID Document');
const CUSTOM = systemType('Library card', { isSystem: false });
const DATA_PAGE = attachment();

let downloads = 0;

beforeEach(() => {
  downloads = 0;
  server.use(
    http.get(`${API_BASE}/storage/objects/:objectId/download`, ({ params }) => {
      downloads += 1;
      return HttpResponse.json({ url: `https://signed.example/${params.objectId as string}`, expiresIn: 300 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** Flush the reveal's fetch and the state updates that follow it under fake timers. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('documentImageSlotsFor and supportsDocumentImages', () => {
  it('gives each type its slots', () => {
    expect(documentImageSlotsFor(CARD).map((s) => s.label)).toEqual(['Front', 'Back']);
    expect(documentImageSlotsFor(PASSPORT).map((s) => s.role)).toEqual(['data_page', 'back']);
    expect(documentImageSlotsFor(ID_DOCUMENT).map((s) => s.role)).toEqual(['front', 'back']);
  });

  it('offers slots to a type with slots, even with no attachments', () => {
    expect(supportsDocumentImages(PASSPORT, [])).toBe(true);
    expect(supportsDocumentImages(ID_DOCUMENT, [])).toBe(true);
  });

  it('offers none to a custom type without role-bearing attachments, or a type without attachments', () => {
    expect(supportsDocumentImages(CUSTOM, [attachment({ role: null })])).toBe(false);
    expect(supportsDocumentImages({ ...PASSPORT, allowAttachments: false }, [])).toBe(false);
  });

  it('falls back to the slots the held roles belong to', () => {
    expect(supportsDocumentImages(CUSTOM, [DATA_PAGE])).toBe(true);
    expect(documentImageSlotsFor(CUSTOM, [DATA_PAGE]).map((s) => s.role)).toEqual(['data_page', 'back']);
    expect(documentImageSlotsFor(undefined, []).map((s) => s.role)).toEqual(['card_front', 'card_back']);
  });
});

describe('DocumentImages', () => {
  it('renders the passport slots with their labels', () => {
    render(<DocumentImages secretId={SECRET_ID} attachments={[]} type={PASSPORT} readOnly />);
    expect(screen.getByRole('heading', { name: 'Passport Images' })).toBeInTheDocument();
    expect(screen.getByText('No data page image')).toBeInTheDocument();
    expect(screen.getByText('No other page image')).toBeInTheDocument();
  });

  it('renders the ID document slots', () => {
    render(<DocumentImages secretId={SECRET_ID} attachments={[]} type={ID_DOCUMENT} readOnly />);
    expect(screen.getByRole('heading', { name: 'ID Document Images' })).toBeInTheDocument();
    expect(screen.getByText('No front image')).toBeInTheDocument();
    expect(screen.getByText('No back image')).toBeInTheDocument();
  });

  it('keeps a card exactly as CardImages showed it', () => {
    render(<DocumentImages secretId={SECRET_ID} attachments={[]} type={CARD} readOnly />);
    expect(screen.getByRole('heading', { name: 'Card Images' })).toBeInTheDocument();
    expect(screen.getByText('No front image')).toBeInTheDocument();
    expect(screen.getByText('No back image')).toBeInTheDocument();
  });

  it('keeps the image hidden, without a download URL, until revealed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);

    expect(screen.getByText('Data page image hidden')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await settle();
    expect(downloads).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();

    expect(screen.getByAltText('Data page of passport')).toHaveAttribute('src', 'https://signed.example/obj-data');
    expect(downloads).toBe(1);
  });

  it('hides the image again after the reveal timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECRET_REVEAL_TIMEOUT_MS - 1);
    });
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByAltText('Data page of passport')).not.toBeInTheDocument();
    expect(screen.getByText('Data page image hidden')).toBeInTheDocument();

    // A new reveal mints a fresh signed URL.
    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();
    expect(downloads).toBe(2);
  });

  it('hides the image again when the attachment changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { rerender } = render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();

    const replaced = attachment({
      id: 'att-data-2',
      storageObject: { id: 'obj-data-2', name: 'new.jpg', mimeType: 'image/jpeg', size: 999 },
    });
    rerender(<DocumentImages secretId={SECRET_ID} attachments={[replaced]} type={PASSPORT} />);

    expect(screen.queryByAltText('Data page of passport')).not.toBeInTheDocument();
    expect(screen.getByText('Data page image hidden')).toBeInTheDocument();
  });

  it('hides the image when the browser tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();

    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else delete (document as { visibilityState?: string }).visibilityState;
    }

    expect(screen.queryByAltText('Data page of passport')).not.toBeInTheDocument();
  });

  it('shows the image hidden again after it is unmounted (a tab or route change) and mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { unmount } = render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal data page image' }));
    await settle();
    expect(screen.getByAltText('Data page of passport')).toBeInTheDocument();
    unmount();

    render(<DocumentImages secretId={SECRET_ID} attachments={[DATA_PAGE]} type={PASSPORT} />);
    expect(screen.queryByAltText('Data page of passport')).not.toBeInTheDocument();
    expect(screen.getByText('Data page image hidden')).toBeInTheDocument();
  });

  it('uploads into the slot role', async () => {
    let linkedRole: unknown;
    server.use(
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ id: 'obj-new', name: 'page.jpg', mimeType: 'image/jpeg', size: 1024 }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        linkedRole = ((await request.json()) as { role?: string }).role;
        return HttpResponse.json({ ...DATA_PAGE, id: 'att-new' });
      }),
    );
    const onChange = vi.fn();
    render(<DocumentImages secretId={SECRET_ID} attachments={[]} type={PASSPORT} onChange={onChange} />);

    const file = new File(['x'], 'page.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Data page image file'), { target: { files: [file] } });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(linkedRole).toBe('data_page');
  });
});
