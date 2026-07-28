import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
import RenewCardPage from '../../pages/RenewCardPage';

const API_BASE = '*/api';
const SECRET_ID = 'card-secret-1';

// jsdom implements neither canvas encoding nor object URLs, so the crop shim is
// replaced wholesale. The geometry it wraps is covered in
// __tests__/utils/cardImage.test.ts.
vi.mock('../../utils/cardImage', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/cardImage')>('../../utils/cardImage');
  return {
    ...actual,
    cropImageFileToCard: vi.fn(async (_file: File, options?: { fileName?: string }) => ({
      dataUrl: 'data:image/jpeg;base64,AAAA',
      file: new File(['bytes'], options?.fileName ?? 'card.jpg', { type: 'image/jpeg' }),
      previewUrl: `blob:${options?.fileName ?? 'card.jpg'}`,
      width: 1400,
      height: 883,
    })),
  };
});

// The adjust stage decodes the picked file via `Image`/`URL.createObjectURL`
// to draw a live preview, and jsdom implements neither meaningfully (`Image`
// never fires `onload`), so the interactive adjuster is replaced by a stub
// that confirms immediately with the default (auto-fit, no pan/zoom/rotation)
// adjustments. Its own interaction is not this page's concern; the geometry it
// wraps is covered in __tests__/utils/cardImage.test.ts.
vi.mock('../../components/cards/CardCropAdjuster', () => ({
  CardCropAdjuster: vi.fn(
    ({ onConfirm }: { onConfirm: (adjustments: Record<string, never>) => void }) => (
      <button type="button" onClick={() => onConfirm({})}>
        Use this photo
      </button>
    ),
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: SECRET_ID }),
  };
});

const CARD_TYPE = {
  id: 'card-type-id',
  name: 'Card',
  description: 'Credit or debit card information',
  icon: 'CreditCard',
  isSystem: true,
  allowAttachments: true,
  createdAt: new Date().toISOString(),
  fields: [
    {
      name: 'card_network',
      label: 'Card Company / Network',
      type: 'select',
      required: false,
      sensitive: false,
      options: ['Visa', 'Mastercard'],
    },
    { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
    { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
    { name: 'exp_month', label: 'Expiration Month', type: 'string', required: true, sensitive: false },
    { name: 'exp_year', label: 'Expiration Year', type: 'string', required: true, sensitive: false },
    { name: 'cvv', label: 'CVV / CVC', type: 'string', required: true, sensitive: true },
    { name: 'issuing_bank', label: 'Issuing Bank', type: 'string', required: false, sensitive: false },
  ],
};

/** The card being renewed: a Visa ending 4242, expiring 07/2026. */
const EXISTING_SECRET = {
  id: SECRET_ID,
  name: 'Visa ••••4242',
  description: null,
  type: CARD_TYPE,
  currentVersion: 3,
  createdAt: new Date('2023-01-01').toISOString(),
  updatedAt: new Date('2024-01-01').toISOString(),
  createdBy: null,
  attachments: [],
  values: {
    card_network: 'Visa',
    cardholder_name: 'ADA LOVELACE',
    number: '4242424242424242',
    exp_month: '07',
    exp_year: '2026',
    cvv: '123',
    issuing_bank: 'Bank of Analytics',
  },
};

/** What the AI reads off the replacement card: new number, new expiry. */
const EXTRACTION = {
  fields: {
    cardholder_name: 'ADA LOVELACE',
    number: '4111111111111111',
    exp_month: '09',
    exp_year: '2031',
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: 'Bank of Analytics',
    security_code_2: null,
  },
  confidence: {
    cardholder_name: 0.95,
    number: 0.99,
    exp_month: 0.9,
    exp_year: 0.9,
    card_network: 0.99,
    card_kind: 0.8,
    issuing_bank: 0.85,
    security_code_2: 0,
  },
  warnings: [],
  model: 'gpt-4o-mini',
  partial: false,
};

function aiStatus(enabled: boolean) {
  return http.get(`${API_BASE}/ai/status`, () =>
    HttpResponse.json({ data: { enabled, features: { cardExtract: enabled } } }),
  );
}

function secretDetail(overrides: Record<string, unknown> = {}) {
  return http.get(`${API_BASE}/secrets/:id`, () =>
    HttpResponse.json({ data: { ...EXISTING_SECRET, ...overrides } }),
  );
}

function extractOk() {
  return http.post(`${API_BASE}/secrets/cards/extract`, () =>
    HttpResponse.json({ data: EXTRACTION }),
  );
}

/**
 * Storage upload stub.
 *
 * Required by any test that captures a photo AND submits: the renewal uploads
 * every new face before calling `/renew`, and an upload failure deliberately
 * aborts the whole renewal rather than half-committing it.
 */
function uploadOk(id = 'object-front') {
  return http.post(`${API_BASE}/storage/objects`, () =>
    HttpResponse.json({ data: { id } }),
  );
}

/** Capture the renewal body so assertions can check it against the DTO. */
function captureRenew() {
  const captured: { body?: Record<string, unknown> } = {};
  server.use(
    http.post(`${API_BASE}/secrets/:id/renew`, async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ data: { ...EXISTING_SECRET, currentVersion: 4 } });
    }),
  );
  return captured;
}

function recordRequests() {
  const seen: string[] = [];
  server.events.removeAllListeners('request:start');
  server.events.on('request:start', ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return seen;
}

/** A form input by its label; scoped to `input` to dodge the reveal toggles. */
function field(label: RegExp): HTMLElement {
  return screen.getByLabelText(label, { selector: 'input' });
}

/**
 * Picks a photo AND confirms the (stubbed) adjust stage, landing on the
 * cropped preview — the same end state `selectPhoto` produced before the
 * adjust stage existed.
 */
function selectPhoto(side: 'front' | 'back') {
  fireEvent.change(screen.getByTestId(`card-${side}-input`), {
    target: { files: [new File(['bytes'], `${side}.png`, { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: /use this photo/i }));
}

/** Skip both photo steps and land on the diff — the pure-manual renewal path. */
async function walkToReviewWithoutPhotos() {
  const skipFront = await screen.findByRole('button', { name: /skip the photo/i });
  fireEvent.click(skipFront);
  fireEvent.click(await screen.findByRole('button', { name: /skip the photo/i }));
  await screen.findByRole('heading', { name: /check what changes/i });
}

/** Photograph the front, skip the back, land on the diff. */
async function walkToReviewWithFrontPhoto() {
  await screen.findByRole('button', { name: /take a photo of the front/i });
  selectPhoto('front');
  fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));

  await screen.findByRole('button', { name: /take a photo of the back/i });
  fireEvent.click(screen.getByRole('button', { name: /skip the photo/i }));
  await screen.findByRole('heading', { name: /check what changes/i });
}

/** The diff line rendered beneath a given field. */
function diffFor(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label}:`, 'i'));
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  server.events.removeAllListeners('request:start');
});

describe('RenewCardPage — works with AI disabled', () => {
  beforeEach(() => {
    server.use(aiStatus(false), secretDetail());
  });

  it('offers the whole wizard, not a "not available" wall', async () => {
    render(<RenewCardPage />);

    expect(
      await screen.findByRole('heading', { name: /renew visa/i }),
    ).toBeInTheDocument();
    // The import wizard's gate must NOT appear here.
    expect(screen.queryByText(/card scanning is not available/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('card-front-input')).toBeInTheDocument();
  });

  it('says photos are stored but not read, and promises no egress', async () => {
    render(<RenewCardPage />);

    expect(
      await screen.findByText(/photos are not read automatically/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent to OpenAI/i)).toBeInTheDocument();
    // The egress warning belongs only to a flow that actually sends something.
    expect(screen.queryByText(/will be sent to OpenAI/i)).not.toBeInTheDocument();
  });

  it('renews by hand end to end without ever calling the extractor', async () => {
    const user = userEvent.setup();
    const seen = recordRequests();
    const captured = captureRenew();
    render(<RenewCardPage />);

    await walkToReviewWithoutPhotos();

    // Seeded from the card being replaced, so only what changed needs typing.
    expect(field(/card number/i)).toHaveValue('4242424242424242');

    await user.clear(field(/card number/i));
    await user.type(field(/card number/i), '4111111111111111');
    await user.clear(field(/expiration year/i));
    await user.type(field(/expiration year/i), '2031');
    await user.type(field(/cvv/i), '999');

    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(seen.filter((r) => r.includes('/cards/extract'))).toHaveLength(0);
    expect(captured.body?.aiAssisted).toBe(false);
    expect(captured.body?.data).toMatchObject({
      number: '4111111111111111',
      exp_year: '2031',
      cvv: '999',
    });
  });

  it('shows only three steps when there is nothing to read', async () => {
    render(<RenewCardPage />);

    await screen.findByRole('heading', { name: /renew visa/i });
    expect(screen.queryByText('Read')).not.toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });
});

describe('RenewCardPage — the per-field diff', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretDetail(), extractOk());
  });

  it('shows current versus proposed for the fields the new card changes', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    const numberDiff = diffFor('Card Number');
    expect(within(numberDiff).getByText('Changes')).toBeInTheDocument();
    // Sensitive values are reduced to their last four in the comparison line.
    expect(within(numberDiff).getByText('•••• 4242')).toBeInTheDocument();
    expect(within(numberDiff).getByText('•••• 1111')).toBeInTheDocument();

    const yearDiff = diffFor('Expiration Year');
    expect(within(yearDiff).getByText('Changes')).toBeInTheDocument();
    expect(within(yearDiff).getByText('2026')).toBeInTheDocument();
    expect(within(yearDiff).getByText('2031')).toBeInTheDocument();
  });

  it('marks the fields that stay the same as unchanged', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    expect(
      within(diffFor('Cardholder Name')).getByText('Unchanged'),
    ).toBeInTheDocument();
    expect(
      within(diffFor('Card Company / Network')).getByText('Unchanged'),
    ).toBeInTheDocument();
  });

  it('never prints a full card number in the comparison line', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    const numberDiff = diffFor('Card Number');
    expect(numberDiff.textContent).not.toMatch(/\d{13,}/);
  });

  it('summarises how many fields move', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    // number, exp_month and exp_year differ from the outgoing card.
    expect(await screen.findByText(/3 fields change/i)).toBeInTheDocument();
  });

  it('updates the diff live as the user edits', async () => {
    const user = userEvent.setup();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    expect(
      within(diffFor('Cardholder Name')).getByText('Unchanged'),
    ).toBeInTheDocument();

    await user.clear(field(/cardholder name/i));
    await user.type(field(/cardholder name/i), 'ADA B LOVELACE');

    await waitFor(() =>
      expect(within(diffFor('Cardholder Name')).getByText('Changes')).toBeInTheDocument(),
    );
  });

  it('explains that the old security code is not carried over', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    const cvvDiff = diffFor('CVV / CVC');
    expect(within(cvvDiff).getByText(/new code needed/i)).toBeInTheDocument();
    // The stored code is never shown, not even masked.
    expect(cvvDiff.textContent).not.toContain('123');
  });
});

describe('RenewCardPage — unchanged fields submit their current value', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretDetail(), extractOk(), uploadOk());
  });

  it('sends a full data object, not a patch of what changed', async () => {
    const user = userEvent.setup();
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    // Every field the type declares and the card holds is present, including
    // the ones the renewal did not touch.
    expect(captured.body?.data).toEqual({
      card_network: 'Visa',
      cardholder_name: 'ADA LOVELACE',
      issuing_bank: 'Bank of Analytics',
      number: '4111111111111111',
      exp_month: '09',
      exp_year: '2031',
      cvv: '999',
    });
  });

  it('keeps a field the extraction could not read', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({
          data: { ...EXTRACTION, fields: { ...EXTRACTION.fields, issuing_bank: null } },
        }),
      ),
    );
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(
      (captured.body?.data as Record<string, string>).issuing_bank,
    ).toBe('Bank of Analytics');
  });

  it('omits a field the user cleared rather than sending an empty string', async () => {
    const user = userEvent.setup();
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.clear(field(/issuing bank/i));
    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(captured.body?.data).not.toHaveProperty('issuing_bank');
  });
});

describe('RenewCardPage — the CVV is mandatory', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretDetail(), extractOk());
  });

  it('never seeds the CVV from the card being replaced', async () => {
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    expect(field(/cvv/i)).toHaveValue('');
  });

  it('blocks the renewal until a new CVV is typed', async () => {
    const user = userEvent.setup();
    const seen = recordRequests();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    const renew = screen.getByRole('button', { name: /renew card/i });
    expect(renew).toBeDisabled();
    expect(screen.getByText(/enter the CVV \/ CVC from the new card/i)).toBeInTheDocument();

    // Clicking a disabled button must not sneak a version through.
    fireEvent.click(renew);
    expect(seen.filter((r) => r.includes('/renew'))).toHaveLength(0);

    await user.type(field(/cvv/i), '999');
    await waitFor(() => expect(renew).toBeEnabled());
  });

  it('blocks the renewal on the manual path too', async () => {
    server.use(aiStatus(false));
    render(<RenewCardPage />);
    await walkToReviewWithoutPhotos();

    expect(screen.getByRole('button', { name: /renew card/i })).toBeDisabled();
  });
});

describe('RenewCardPage — aiAssisted reflects what happened', () => {
  it('is true when extracted values survive into the payload', async () => {
    const user = userEvent.setup();
    server.use(aiStatus(true), secretDetail(), extractOk(), uploadOk());
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(captured.body?.aiAssisted).toBe(true);
  });

  it('is false when the values were typed with no extraction at all', async () => {
    const user = userEvent.setup();
    server.use(aiStatus(true), secretDetail(), extractOk());
    const captured = captureRenew();
    render(<RenewCardPage />);

    // Skipping both photos means there is nothing to read, so no call is made.
    await walkToReviewWithoutPhotos();
    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(captured.body?.aiAssisted).toBe(false);
  });

  it('is false when the extraction failed and the user typed instead', async () => {
    const user = userEvent.setup();
    server.use(
      aiStatus(true),
      secretDetail(),
      uploadOk(),
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json(
          { message: 'nope', code: 'AI_EXTRACTION_FAILED', statusCode: 422 },
          { status: 422 },
        ),
      ),
    );
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    // The failure is not a dead end: the outgoing card's values are still here.
    expect(screen.getByText(/sharper, better-lit photo/i)).toBeInTheDocument();
    expect(field(/card number/i)).toHaveValue('4242424242424242');

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(captured.body?.aiAssisted).toBe(false);
  });
});

describe('RenewCardPage — the request body matches the endpoint DTO', () => {
  it('sends data, role-tagged attachments and aiAssisted, and nothing else', async () => {
    const user = userEvent.setup();
    server.use(
      aiStatus(true),
      secretDetail(),
      extractOk(),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-front' } }),
      ),
    );
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(Object.keys(captured.body ?? {}).sort()).toEqual([
      'aiAssisted',
      'attachments',
      'data',
    ]);
    expect(captured.body?.attachments).toEqual([
      { storageObjectId: 'object-front', role: 'card_front', label: 'card-front.jpg' },
    ]);
  });

  it('omits attachments entirely when no new photo was taken', async () => {
    const user = userEvent.setup();
    server.use(aiStatus(false), secretDetail());
    const captured = captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithoutPhotos();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    // An empty array is a 400 on a type that forbids attachments, and says
    // nothing useful on one that allows them.
    expect(captured.body).not.toHaveProperty('attachments');
  });

  it('tags both faces with their roles when both are replaced', async () => {
    const user = userEvent.setup();
    const uploaded: string[] = [];
    server.use(
      aiStatus(true),
      secretDetail(),
      extractOk(),
      http.post(`${API_BASE}/storage/objects`, () => {
        const id = `object-${uploaded.length + 1}`;
        uploaded.push(id);
        return HttpResponse.json({ data: { id } });
      }),
    );
    const captured = captureRenew();
    render(<RenewCardPage />);

    await screen.findByRole('button', { name: /take a photo of the front/i });
    selectPhoto('front');
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
    await screen.findByRole('button', { name: /take a photo of the back/i });
    selectPhoto('back');
    fireEvent.click(await screen.findByRole('button', { name: /read the card/i }));
    await screen.findByRole('heading', { name: /check what changes/i });

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() => expect(captured.body).toBeDefined());
    expect(captured.body?.attachments).toEqual([
      expect.objectContaining({ role: 'card_front' }),
      expect.objectContaining({ role: 'card_back' }),
    ]);
  });
});

describe('RenewCardPage — abandoning leaves nothing behind', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretDetail(), extractOk());
  });

  it('creates no version and uploads nothing when cancelled from the diff', async () => {
    const seen = recordRequests();
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/secrets/${SECRET_ID}`),
    );
    expect(seen.filter((r) => r.includes('/renew'))).toHaveLength(0);
    expect(seen.filter((r) => r.startsWith('POST /api/storage'))).toHaveLength(0);
  });

  it('creates no version when cancelled from the capture step', async () => {
    const seen = recordRequests();
    render(<RenewCardPage />);

    await screen.findByRole('button', { name: /take a photo of the front/i });
    selectPhoto('front');
    await screen.findByAltText(/cropped front of the card/i);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(seen.filter((r) => r.includes('/renew'))).toHaveLength(0);
    expect(seen.filter((r) => r.startsWith('POST /api/storage'))).toHaveLength(0);
  });

  it('deletes the uploaded photo when the renewal itself fails', async () => {
    const user = userEvent.setup();
    const seen = recordRequests();
    server.use(
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-front' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/renew`, () =>
        HttpResponse.json({ message: 'Concurrent renewal' }, { status: 409 }),
      ),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    render(<RenewCardPage />);
    await walkToReviewWithFrontPhoto();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    // The upload is rolled back rather than left pointing at nothing, and the
    // user stays put with their edits intact.
    await waitFor(() =>
      expect(seen).toContain('DELETE /api/storage/objects/object-front'),
    );
    expect(await screen.findByText(/concurrent renewal/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith(`/secrets/${SECRET_ID}`);
    expect(field(/card number/i)).toHaveValue('4111111111111111');
  });
});

describe('RenewCardPage — after a successful renewal', () => {
  it('lands on the card, where the old version stays readable', async () => {
    const user = userEvent.setup();
    server.use(aiStatus(false), secretDetail());
    captureRenew();
    render(<RenewCardPage />);
    await walkToReviewWithoutPhotos();

    await user.type(field(/cvv/i), '999');
    fireEvent.click(screen.getByRole('button', { name: /renew card/i }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/secrets/${SECRET_ID}`,
        expect.objectContaining({ state: { renewed: true } }),
      ),
    );
  });
});

describe('RenewCardPage — the card cannot be loaded', () => {
  it('explains the failure instead of rendering an empty wizard', async () => {
    server.use(
      aiStatus(true),
      http.get(`${API_BASE}/secrets/:id`, () =>
        HttpResponse.json({ message: 'Secret not found' }, { status: 404 }),
      ),
    );
    render(<RenewCardPage />);

    expect(
      await screen.findByText(/this card could not be loaded/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('card-front-input')).not.toBeInTheDocument();
  });
});
