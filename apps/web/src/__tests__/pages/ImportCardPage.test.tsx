import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mockAdminUser, mockUser, render } from '../utils/test-utils';
import { server } from '../mocks/server';
import ImportCardPage from '../../pages/ImportCardPage';
import type { CardCropBox } from '../../types';
import {
  cropImageFileToBox,
  cropImageFileToCard,
  prepareCardPhoto,
} from '../../utils/cardImage';

const API_BASE = '*/api';

// jsdom implements neither canvas encoding nor object URLs, so every
// canvas-touching export the page calls directly is replaced wholesale:
//  - `prepareCardPhoto` (the FULL photo sent to extraction)
//  - `cropImageFileToBox` (stored-attachment crop from the AI's box)
//  - `cropImageFileToCard` (the centred auto-fit fallback)
// Each returns a value distinguishable from the others so a test can assert
// which path a given side actually took. The geometry they wrap is covered in
// __tests__/utils/cardImage.test.ts.
vi.mock('../../utils/cardImage', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/cardImage')>('../../utils/cardImage');
  return {
    ...actual,
    prepareCardPhoto: vi.fn(async (file: File) => ({
      dataUrl: `data:image/jpeg;base64,PREPARED-${file.name}`,
      width: 1600,
      height: 1200,
    })),
    cropImageFileToBox: vi.fn(
      async (_file: File, _box: CardCropBox, options?: { fileName?: string }) => ({
        dataUrl: 'data:image/jpeg;base64,BOXCROP',
        // Distinct byte length from both the raw capture ('bytes', 5) and the
        // auto-fit fallback below — msw's Request/FormData round trip through
        // jsdom loses a File's `name` (it comes back as the literal "blob"),
        // so tests distinguish which crop path ran by content size instead.
        file: new File(['box-cropped-bytes'], options?.fileName ?? 'card.jpg', {
          type: 'image/jpeg',
        }),
        previewUrl: `blob:box-${options?.fileName ?? 'card.jpg'}`,
        width: 1400,
        height: 883,
      }),
    ),
    cropImageFileToCard: vi.fn(
      async (_file: File, options?: { fileName?: string }) => ({
        dataUrl: 'data:image/jpeg;base64,AUTOFIT',
        file: new File(['autofit-cropped'], options?.fileName ?? 'card.jpg', {
          type: 'image/jpeg',
        }),
        previewUrl: `blob:autofit-${options?.fileName ?? 'card.jpg'}`,
        width: 1400,
        height: 883,
      }),
    ),
  };
});

// Only reached via "Adjust crop" on the review step (CardCropReview), which
// none of these flow tests click. Decoding the picked file via `Image` to
// draw a live preview is not something jsdom can do meaningfully (`Image`
// never fires `onload`), so the interactive adjuster is replaced by a stub
// that confirms immediately with the default (auto-fit, no pan/zoom/rotation)
// adjustments were it ever opened. Its own interaction is not this page's
// concern; the geometry it wraps is covered in __tests__/utils/cardImage.test.ts.
vi.mock('../../components/cards/CardCropAdjuster', () => ({
  CardCropAdjuster: vi.fn(
    ({ onConfirm }: { onConfirm: (adjustments: Record<string, never>) => void }) => (
      <button type="button" onClick={() => onConfirm({})}>
        Apply crop
      </button>
    ),
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
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
      options: ['Visa', 'Mastercard', 'Other'],
    },
    { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
    { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
    { name: 'exp_month', label: 'Expiration Month', type: 'string', required: true, sensitive: false },
    { name: 'exp_year', label: 'Expiration Year', type: 'string', required: true, sensitive: false },
    { name: 'cvv', label: 'CVV / CVC', type: 'string', required: true, sensitive: true },
    { name: 'issuing_bank', label: 'Issuing Bank', type: 'string', required: false, sensitive: false },
  ],
};

const EXTRACTION = {
  fields: {
    cardholder_name: 'ADA LOVELACE',
    number: '4242424242424242',
    exp_month: '07',
    exp_year: '2029',
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: 'Bank of Analytics',
    security_code_2: null,
  },
  confidence: {
    cardholder_name: 0.95,
    number: 0.42,
    exp_month: 0.9,
    exp_year: 0.9,
    card_network: 0.99,
    card_kind: 0.8,
    issuing_bank: 0.85,
    security_code_2: 0,
  },
  warnings: ['The card number did not pass its checksum.'],
  model: 'gpt-4o-mini',
  partial: false,
  // No box by default: existing tests exercise the auto-fit fallback path.
  // The dedicated "crop routing" describe block below overrides this per-test.
  crops: { front: null, back: null },
};

function aiStatus(enabled: boolean) {
  return http.get(`${API_BASE}/ai/status`, () =>
    HttpResponse.json({ data: { enabled, features: { cardExtract: enabled } } }),
  );
}

function secretTypes() {
  return http.get(`${API_BASE}/secret-types`, () =>
    HttpResponse.json({ data: [CARD_TYPE] }),
  );
}

function extractOk() {
  return http.post(`${API_BASE}/secrets/cards/extract`, () =>
    HttpResponse.json({ data: EXTRACTION }),
  );
}

function extractFails(status: number, code: string, message = 'Extraction failed') {
  return http.post(`${API_BASE}/secrets/cards/extract`, () =>
    HttpResponse.json({ message, code, statusCode: status }, { status }),
  );
}

function recordRequests() {
  const seen: string[] = [];
  server.events.removeAllListeners('request:start');
  server.events.on('request:start', ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return seen;
}

/**
 * A form input by its label.
 *
 * Scoped to `input` because the reveal toggles carry aria-labels ("Show Card
 * Number") that match the same field regexes.
 */
function field(label: RegExp): HTMLElement {
  return screen.getByLabelText(label, { selector: 'input' });
}

/**
 * Picks a photo. The capture step has no adjuster of its own — it just shows
 * the full raw photo with Retake/Continue once `prepareCardPhoto` (mocked)
 * resolves.
 */
function selectPhoto(side: 'front' | 'back') {
  const input = screen.getByTestId(`card-${side}-input`);
  fireEvent.change(input, {
    target: { files: [new File(['bytes'], `${side}.png`, { type: 'image/png' })] },
  });
}

/** Front capture -> skip the back -> land on the review step. */
async function walkToReview() {
  await screen.findByRole('button', { name: /take a photo of the front/i });
  selectPhoto('front');
  await screen.findByRole('button', { name: /^continue$/i });
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

  const skip = await screen.findByRole('button', { name: /skip the back/i });
  fireEvent.click(skip);

  await screen.findByRole('heading', { name: /check the details/i });
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  server.events.removeAllListeners('request:start');
});

describe('ImportCardPage — availability gating', () => {
  it('hides the wizard and explains why when AI is disabled', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />);

    expect(
      await screen.findByText(/card scanning is not available/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('card-front-input')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /take a photo/i }),
    ).not.toBeInTheDocument();
  });

  it('points an administrator at System Settings', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />, { wrapperOptions: { user: mockAdminUser } });

    const button = await screen.findByRole('button', { name: /open system settings/i });
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/admin/settings');
  });

  it('never offers a non-admin an API key form', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />, { wrapperOptions: { user: mockUser } });

    await screen.findByText(/card scanning is not available/i);

    expect(
      screen.queryByRole('button', { name: /system settings/i }),
    ).not.toBeInTheDocument();
    // No input of any kind: nothing on this page should ever take a credential.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
  });

  it('fails closed when the status call itself errors', async () => {
    server.use(
      http.get(`${API_BASE}/ai/status`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    render(<ImportCardPage />);

    expect(
      await screen.findByText(/card scanning is not available/i),
    ).toBeInTheDocument();
  });
});

describe('ImportCardPage — capture and egress', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('warns that the photo goes to OpenAI before any call is made', async () => {
    const seen = recordRequests();
    render(<ImportCardPage />);

    expect(await screen.findByText(/will be sent to OpenAI/i)).toBeInTheDocument();
    expect(
      screen.getByText(/includes your security code \(CVV \/ CVC\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/read from the photo/i)).toBeInTheDocument();
    expect(seen.filter((r) => r.includes('/cards/extract'))).toHaveLength(0);
  });

  it('previews the raw photo (no crop) and offers a retake before continuing', async () => {
    render(<ImportCardPage />);
    await screen.findByRole('button', { name: /take a photo of the front/i });

    selectPhoto('front');

    expect(
      await screen.findByAltText(/photo of the front of the card/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
    // No adjuster and no crop happens at capture time.
    expect(screen.queryByRole('button', { name: /apply crop/i })).not.toBeInTheDocument();
  });

  it('sends the prepared full-frame photos, not a cropped version, to extraction', async () => {
    let body: { front?: string; back?: string } = {};
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, async ({ request }) => {
        body = (await request.json()) as { front?: string; back?: string };
        return HttpResponse.json({ data: EXTRACTION });
      }),
    );
    render(<ImportCardPage />);

    await screen.findByRole('button', { name: /take a photo of the front/i });
    selectPhoto('front');
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));

    await screen.findByRole('button', { name: /take a photo of the back/i });
    selectPhoto('back');
    fireEvent.click(await screen.findByRole('button', { name: /read the card/i }));

    await screen.findByRole('heading', { name: /check the details/i });
    expect(body.front).toMatch(/^data:image\/jpeg;base64,PREPARED-front\.png/);
    expect(body.back).toMatch(/^data:image\/jpeg;base64,PREPARED-back\.png/);
  });

  it('sends only the front when the back is skipped', async () => {
    let body: { front?: string; back?: string } = {};
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, async ({ request }) => {
        body = (await request.json()) as { front?: string; back?: string };
        return HttpResponse.json({ data: EXTRACTION });
      }),
    );
    render(<ImportCardPage />);
    await walkToReview();

    expect(body.front).toBeTruthy();
    expect(body.back).toBeUndefined();
  });
});

describe('ImportCardPage — crop routing', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes());
  });

  it('crops the front from the AI box when the extraction returns one', async () => {
    const box: CardCropBox = {
      x: 0.1,
      y: 0.15,
      width: 0.6,
      height: 0.4,
      quarterTurns: 0,
      confidence: 0.92,
    };
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({ data: { ...EXTRACTION, crops: { front: box, back: null } } }),
      ),
    );
    render(<ImportCardPage />);
    await walkToReview();

    expect(vi.mocked(cropImageFileToBox)).toHaveBeenCalledWith(
      expect.any(File),
      box,
      expect.objectContaining({ fileName: 'card-front.jpg' }),
    );
    expect(vi.mocked(cropImageFileToCard)).not.toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ fileName: 'card-front.jpg' }),
    );
    // The box crop is what renders on the review step.
    expect(
      await screen.findByAltText(/cropped front of the card/i),
    ).toHaveAttribute('src', 'blob:box-card-front.jpg');
  });

  it('falls back to the centred auto-fit crop when no box is returned', async () => {
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({ data: { ...EXTRACTION, crops: { front: null, back: null } } }),
      ),
    );
    render(<ImportCardPage />);
    await walkToReview();

    expect(vi.mocked(cropImageFileToBox)).not.toHaveBeenCalled();
    expect(vi.mocked(cropImageFileToCard)).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ fileName: 'card-front.jpg' }),
    );
    expect(
      await screen.findByAltText(/cropped front of the card/i),
    ).toHaveAttribute('src', 'blob:autofit-card-front.jpg');
  });

  it('uploads the cropped file on save, never the raw capture', async () => {
    const user = userEvent.setup();
    let uploadedSize = -1;
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({ data: { ...EXTRACTION, crops: { front: null, back: null } } }),
      ),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-9' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        uploadedSize = file.size;
        return HttpResponse.json({ data: { id: 'object-1' } });
      }),
      http.post(`${API_BASE}/secrets/:id/attachments`, () =>
        HttpResponse.json({ data: { id: 'attachment-1' } }),
      ),
    );
    render(<ImportCardPage />);
    await walkToReview();

    await user.type(field(/cvv/i), '123');
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(uploadedSize).toBeGreaterThanOrEqual(0));
    // Cropped (auto-fit, since this response has no box) content, never the
    // raw 5-byte `front.png` capture the user actually picked.
    expect(uploadedSize).toBe('autofit-cropped'.length);
    expect(uploadedSize).not.toBe('bytes'.length);
  });
});

describe('ImportCardPage — review step', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('pre-fills every extracted field and flags the low-confidence one', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    expect(field(/cardholder name/i)).toHaveValue('ADA LOVELACE');
    expect(field(/card number/i)).toHaveValue('4242424242424242');
    expect(field(/expiration month/i)).toHaveValue('07');
    expect(field(/issuing bank/i)).toHaveValue('Bank of Analytics');

    // number came back at 0.42 confidence; cardholder_name at 0.95 did not.
    // MUI renders the outlined label twice (visible label + notch legend), so
    // the flag chip legitimately appears more than once inside one field.
    const numberField = field(/card number/i).closest('.MuiFormControl-root');
    expect(
      within(numberField as HTMLElement).getAllByText('Check').length,
    ).toBeGreaterThan(0);

    const nameField = field(/cardholder name/i).closest('.MuiFormControl-root');
    expect(within(nameField as HTMLElement).queryByText('Check')).not.toBeInTheDocument();
  });

  it('renders the warnings the API returned', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    expect(
      screen.getByText(/did not pass its checksum/i),
    ).toBeInTheDocument();
  });

  it('masks the card number until it is revealed', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    const numberInput = field(/card number/i);
    expect(numberInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /show card number/i }));
    expect(numberInput).toHaveAttribute('type', 'text');
  });

  it('defaults the name to the network and last four digits', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    const nameInput = field(/^name/i);
    expect(nameInput).toHaveValue('Visa ••••4242');
    expect(nameInput).not.toHaveValue(expect.stringContaining('4242424242424242'));
  });
});

describe('ImportCardPage — CVV is mandatory', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('leaves the CVV empty because the API never returns one', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    expect(field(/cvv/i)).toHaveValue('');
    expect(screen.getByText(/not read from the photo/i)).toBeInTheDocument();
  });

  it('blocks Save until the CVV is entered', async () => {
    const user = userEvent.setup();
    const seen = recordRequests();
    render(<ImportCardPage />);
    await walkToReview();

    const save = screen.getByRole('button', { name: /save card/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/enter the CVV \/ CVC to save/i)).toBeInTheDocument();

    // Clicking a disabled button must not sneak a secret through.
    fireEvent.click(save);
    expect(seen.filter((r) => r === 'POST /api/secrets')).toHaveLength(0);

    await user.type(field(/cvv/i), '123');

    await waitFor(() => expect(save).toBeEnabled());
  });

  it('sends the hand-typed CVV with the created secret', async () => {
    const user = userEvent.setup();
    let body: { data?: Record<string, string>; name?: string } = {};
    server.use(
      http.post(`${API_BASE}/secrets`, async ({ request }) => {
        body = (await request.json()) as { data?: Record<string, string>; name?: string };
        return HttpResponse.json({ data: { id: 'secret-9' } });
      }),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, () =>
        HttpResponse.json({ data: { id: 'attachment-1' } }),
      ),
    );
    render(<ImportCardPage />);
    await walkToReview();

    await user.type(field(/cvv/i), '123');
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/secrets/secret-9'));
    expect(body.data?.cvv).toBe('123');
    expect(body.data?.number).toBe('4242424242424242');
    expect(body.name).toBe('Visa ••••4242');
  });
});

describe('ImportCardPage — extraction failure falls back to manual entry', () => {
  it('lands on the review step with an empty, editable form', async () => {
    server.use(
      aiStatus(true),
      secretTypes(),
      extractFails(422, 'UNPROCESSABLE_ENTITY'),
    );
    render(<ImportCardPage />);
    await walkToReview();

    expect(screen.getByText(/the card could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/your photos were kept/i)).toBeInTheDocument();

    // Every field is present and empty, so the card can simply be typed in.
    expect(field(/cardholder name/i)).toHaveValue('');
    expect(field(/card number/i)).toHaveValue('');
    expect(field(/cvv/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /save card/i })).toBeInTheDocument();
  });

  it('still attaches the captured photos to the manually typed card', async () => {
    const user = userEvent.setup();
    const linked: { role?: string }[] = [];
    server.use(
      aiStatus(true),
      secretTypes(),
      extractFails(422, 'UNPROCESSABLE_ENTITY'),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-9' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, async ({ request }) => {
        linked.push((await request.json()) as { role?: string });
        return HttpResponse.json({ data: { id: 'attachment-1' } });
      }),
    );
    render(<ImportCardPage />);
    await walkToReview();

    await user.type(field(/cardholder name/i), 'Ada Lovelace');
    await user.type(field(/card number/i), '4242424242424242');
    await user.type(field(/expiration month/i), '07');
    await user.type(field(/expiration year/i), '2029');
    await user.type(field(/cvv/i), '123');

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/secrets/secret-9'));
    expect(linked).toEqual([expect.objectContaining({ role: 'card_front' })]);
  });
});

describe('ImportCardPage — error codes get their own message', () => {
  const cases: {
    label: string;
    status: number;
    code: string;
    expected: RegExp;
  }[] = [
    {
      label: 'AI_NOT_CONFIGURED',
      status: 503,
      code: 'AI_NOT_CONFIGURED',
      expected: /administrator needs to enable AI/i,
    },
    {
      label: 'AI_KEY_UNREADABLE',
      status: 503,
      code: 'AI_KEY_UNREADABLE',
      expected: /could not be read.*re-enter it/i,
    },
    {
      label: 'AI_INVALID_IMAGE',
      status: 400,
      code: 'AI_INVALID_IMAGE',
      expected: /images were not accepted/i,
    },
    {
      label: 'AI_RATE_LIMITED (burst)',
      status: 429,
      code: 'AI_RATE_LIMITED',
      expected: /wait a moment and try again shortly/i,
    },
    {
      label: 'AI_QUOTA_EXCEEDED (daily)',
      status: 429,
      code: 'AI_QUOTA_EXCEEDED',
      expected: /daily card scan allowance/i,
    },
    {
      label: 'AI_UPSTREAM_AUTH',
      status: 502,
      code: 'AI_UPSTREAM_AUTH',
      expected: /rejected the configured API key/i,
    },
    {
      label: 'AI_UPSTREAM_RATE_LIMITED',
      status: 429,
      code: 'AI_UPSTREAM_RATE_LIMITED',
      expected: /provider is rate limiting/i,
    },
    {
      label: 'AI_UPSTREAM_UNAVAILABLE',
      status: 502,
      code: 'AI_UPSTREAM_UNAVAILABLE',
      expected: /provider could not be reached/i,
    },
    {
      label: 'AI_EXTRACTION_FAILED',
      status: 422,
      code: 'AI_EXTRACTION_FAILED',
      expected: /sharper, better-lit photo/i,
    },
    {
      // What actually arrives today, because the global exception filter
      // overwrites the AI code (issue #35).
      label: 'clobbered 429',
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      expected: /either too many scans in a short period, or your daily allowance/i,
    },
  ];

  it.each(cases)('renders a distinct message for $label', async ({ status, code, expected }) => {
    server.use(aiStatus(true), secretTypes(), extractFails(status, code));
    render(<ImportCardPage />);
    await walkToReview();

    expect(screen.getByText(expected)).toBeInTheDocument();
    // Whatever went wrong, manual entry is always still on the table.
    expect(screen.getByRole('button', { name: /save card/i })).toBeInTheDocument();
  });
});

describe('ImportCardPage — cancelling leaves nothing behind', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('creates no secret when cancelled from the capture step', async () => {
    const seen = recordRequests();
    render(<ImportCardPage />);

    await screen.findByRole('button', { name: /take a photo of the front/i });
    selectPhoto('front');
    await screen.findByAltText(/photo of the front of the card/i);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/cards'));
    expect(seen.filter((r) => r === 'POST /api/secrets')).toHaveLength(0);
    expect(seen.filter((r) => r.startsWith('POST /api/storage'))).toHaveLength(0);
  });

  it('creates no secret when cancelled from the review step', async () => {
    const seen = recordRequests();
    render(<ImportCardPage />);
    await walkToReview();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/cards'));
    expect(seen.filter((r) => r === 'POST /api/secrets')).toHaveLength(0);
    expect(seen.filter((r) => r.startsWith('POST /api/storage'))).toHaveLength(0);
  });

  it('deletes an orphaned upload when the save could not link it', async () => {
    const user = userEvent.setup();
    const seen = recordRequests();
    server.use(
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-9' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, () =>
        HttpResponse.json({ data: { id: 'object-1' } }),
      ),
      http.post(`${API_BASE}/secrets/:id/attachments`, () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
      http.delete(`${API_BASE}/storage/objects/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    render(<ImportCardPage />);
    await walkToReview();

    await user.type(field(/cvv/i), '123');
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    expect(
      await screen.findByText(/card saved, photos not attached/i),
    ).toBeInTheDocument();
    expect(seen).toContain('DELETE /api/storage/objects/object-1');
    // The card itself is kept — hand-typed details are not thrown away over a
    // failed image link.
    expect(seen).not.toContain('DELETE /api/secrets/secret-9');
  });
});
