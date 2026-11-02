import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mockAdminUser, mockUser, render as baseRender } from '../utils/test-utils.js';
import type { ReactElement } from 'react';
import { server } from '../mocks/server.js';
import ImportCardPage from '../../src/cards/ui/pages/ImportCardPage.js';
import type { CardCropBox } from '../../src/core/headless/types.js';
import {
  cropImageFileToBox,
  cropImageFileToCard,
} from '../../src/cards/headless/cardImage.js';

const API_BASE = '*/api';

// jsdom implements neither canvas encoding nor object URLs, so every
// canvas-touching export the page calls directly is replaced wholesale:
//  - `prepareCardPhoto` (the FULL photo sent to extraction)
//  - `cropImageFileToBox` (stored-attachment crop from the AI's box)
//  - `cropImageFileToCard` (the centred auto-fit fallback)
// Each returns a value distinguishable from the others so a test can assert
// which path a given side actually took. The geometry they wrap is covered in
// __tests__/utils/cardImage.test.ts.
vi.mock('../../src/cards/headless/cardImage.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/cards/headless/cardImage.js')>('../../src/cards/headless/cardImage.js');
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
vi.mock('../../src/cards/ui/components/CardCropAdjuster.js', () => ({
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
    cardholder_name: 'PERSON A',
    number: '4242424242424242',
    exp_month: '07',
    exp_year: '2029',
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: 'Bank Alpha',
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


/**
 * A member who may scan cards: `secrets:write` and the platform's `ai:use` (E8.2:
 * without `ai:use` the scan option is hidden). Every test renders as this user
 * unless it passes another one.
 */
const SCANNER = {
  ...mockUser,
  roles: [{ name: 'contributor' }],
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'ai:use'],
};
const ADMIN = { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'ai:use', 'ai_config:read', 'ai_config:write'] };

function render(ui: ReactElement, options: Parameters<typeof baseRender>[1] = {}) {
  return baseRender(ui, { ...options, wrapperOptions: { user: SCANNER, ...options.wrapperOptions } });
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

/**
 * The Crop step (E10.5): the cropped photos with "Adjust crop", then on to the
 * Review step.
 */
async function passCropStep() {
  await screen.findByRole('heading', { name: /check the crop/i });
  fireEvent.click(screen.getByRole('button', { name: /continue to details/i }));
  await screen.findByRole('heading', { name: /check the details/i });
}

/** Front capture -> skip the back -> Crop -> land on the review step. */
async function walkToReview() {
  await screen.findByRole('button', { name: /take a photo of the front/i });
  selectPhoto('front');
  await screen.findByRole('button', { name: /^continue$/i });
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

  const skip = await screen.findByRole('button', { name: /skip the back/i });
  fireEvent.click(skip);

  await passCropStep();
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
  it('hides the wizard and says AI is off when an admin switched it off', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />);

    expect(await screen.findByText('AI is off')).toBeInTheDocument();
    expect(screen.getByText(/AI is off — an admin can turn it on in Console → AI/)).toBeInTheDocument();
    expect(screen.queryByTestId('card-front-input')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /take a photo/i })).not.toBeInTheDocument();
    // A member cannot open the Console page, so no link is offered.
    expect(screen.queryByRole('button', { name: /open console → ai/i })).not.toBeInTheDocument();
  });

  it('says AI is not set up yet when AI is on but card scanning is unavailable', async () => {
    server.use(
      http.get(`${API_BASE}/ai/status`, () =>
        HttpResponse.json({ data: { enabled: true, features: { cardExtract: false } } }),
      ),
    );
    render(<ImportCardPage />);

    expect(await screen.findByText('AI is not set up yet')).toBeInTheDocument();
  });

  it('points an administrator at Console → AI', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />, { wrapperOptions: { user: ADMIN } });

    const button = await screen.findByRole('button', { name: /open console → ai/i });
    fireEvent.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/admin/settings/ai');
  });

  it('hides the scan option from a viewer without ai:use, even with AI on', async () => {
    server.use(aiStatus(true));
    render(<ImportCardPage />, { wrapperOptions: { user: mockUser } });

    expect(await screen.findByText('Card scanning is not available to you')).toBeInTheDocument();
    expect(screen.queryByTestId('card-front-input')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open console → ai/i })).not.toBeInTheDocument();
  });

  it('never offers anyone an API key form', async () => {
    server.use(aiStatus(false));
    render(<ImportCardPage />, { wrapperOptions: { user: ADMIN } });

    await screen.findByText('AI is off');
    // No input of any kind: nothing on this page should ever take a credential.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('fails closed when the status call itself errors', async () => {
    server.use(
      http.get(`${API_BASE}/ai/status`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    render(<ImportCardPage />);

    expect(await screen.findByText('AI is off')).toBeInTheDocument();
    expect(screen.queryByTestId('card-front-input')).not.toBeInTheDocument();
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
    // The CVV is typed by hand, never filled in from the photo (E10.5).
    expect(
      screen.getByText(/security code \(CVV \/ CVC\) is never filled in from the photo/i),
    ).toBeInTheDocument();
    // The notice sits above the camera button: read before anything is taken.
    const notice = screen.getByRole('note', { name: /will be sent to OpenAI/i });
    const camera = screen.getByRole('button', { name: /take a photo of the front/i });
    expect(
      notice.compareDocumentPosition(camera) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

    await passCropStep();
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
    const appendSpy = vi.spyOn(FormData.prototype, 'append');
    const appendedFileSize = () => {
      const call = appendSpy.mock.calls.find(([name]) => name === 'file');
      return call ? (call[1] as File).size : -1;
    };
    server.use(
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({ data: { ...EXTRACTION, crops: { front: null, back: null } } }),
      ),
      http.post(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { id: 'secret-9' } }),
      ),
      http.post(`${API_BASE}/storage/objects`, async () => {
        // Not `request.formData()`: undici cannot read a jsdom `File`, so the
        // part arrives empty (and the parse asserts on Node 24). The file the
        // page handed to the upload is read from the `FormData.append` spy.
        uploadedSize = appendedFileSize();
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
    appendSpy.mockRestore();
  });
});

describe('ImportCardPage — review step', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('pre-fills every extracted field and flags the low-confidence one', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    expect(field(/cardholder name/i)).toHaveValue('PERSON A');
    expect(field(/card number/i)).toHaveValue('4242424242424242');
    expect(field(/expiration month/i)).toHaveValue('07');
    expect(field(/issuing bank/i)).toHaveValue('Bank Alpha');

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

    await user.type(field(/cardholder name/i), 'Person A');
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
      expected: /AI is not set up yet — an administrator needs to add the OpenAI key/i,
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

describe('ImportCardPage — AI switched off or not set up mid-flow (E8.2)', () => {
  function extractDisabled() {
    return http.post(`${API_BASE}/secrets/cards/extract`, () =>
      HttpResponse.json(
        { message: 'AI is disabled', code: 'FORBIDDEN', statusCode: 403, details: { reason: 'AI_DISABLED' } },
        { status: 403 },
      ),
    );
  }

  it('maps 403 AI_DISABLED to "AI is off" and links an administrator to Console → AI', async () => {
    server.use(aiStatus(true), secretTypes(), extractDisabled());
    render(<ImportCardPage />, { wrapperOptions: { user: ADMIN } });
    await walkToReview();

    expect(screen.getByText(/AI is off — an admin can turn it on in Console → AI/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Console → AI' })).toHaveAttribute('href', '/admin/settings/ai');
    // Manual entry stays available, and there is nothing to retry.
    expect(screen.getByRole('button', { name: /save card/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows the same message to a member without the link', async () => {
    server.use(aiStatus(true), secretTypes(), extractDisabled());
    render(<ImportCardPage />);
    await walkToReview();

    expect(screen.getByText(/AI is off — an admin can turn it on/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Console → AI' })).not.toBeInTheDocument();
  });

  it('maps 503 AI_NOT_CONFIGURED to "AI is not set up yet"', async () => {
    server.use(aiStatus(true), secretTypes(), extractFails(503, 'AI_NOT_CONFIGURED'));
    render(<ImportCardPage />, { wrapperOptions: { user: ADMIN } });
    await walkToReview();

    expect(screen.getByText('AI is not set up yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Console → AI' })).toBeInTheDocument();
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

/** The step the stepper marks active (`aria-current="step"`). */
function activeStep(): string | null {
  const step = screen.getByRole('list', { hidden: true, name: /progress/i })
    ?.querySelector('[aria-current="step"]');
  return step?.textContent ?? null;
}

describe('ImportCardPage — Capture → Crop → Review → Save stepper (E10.5)', () => {
  it('walks the four steps in order with the AI mocked', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    server.use(
      aiStatus(true),
      secretTypes(),
      extractOk(),
      http.post(`${API_BASE}/secrets`, async () => {
        // Hold the save open so the Save step can be observed.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
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

    await screen.findByRole('button', { name: /take a photo of the front/i });
    for (const label of ['Capture', 'Crop', 'Review', 'Save']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(activeStep()).toMatch(/capture/i);

    selectPhoto('front');
    fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /skip the back/i }));

    await screen.findByRole('heading', { name: /check the crop/i });
    expect(activeStep()).toMatch(/crop/i);
    // The crop is adjustable here, and the AI's work is summarised.
    expect(screen.getByRole('button', { name: /adjust crop/i })).toBeInTheDocument();
    expect(screen.getByText(/details? read from the photo/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue to details/i }));
    await screen.findByRole('heading', { name: /check the details/i });
    expect(activeStep()).toMatch(/review/i);

    await user.type(field(/cvv/i), '123');
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(activeStep()).toMatch(/save/i));
    release();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/secrets/secret-9'));
  });

  it('goes back to the Crop step from the review summary', async () => {
    server.use(aiStatus(true), secretTypes(), extractOk());
    render(<ImportCardPage />);
    await walkToReview();

    expect(screen.getByAltText(/cropped front of the card/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change crop/i }));

    expect(
      await screen.findByRole('heading', { name: /check the crop/i }),
    ).toBeInTheDocument();
  });
});

describe('ImportCardPage — the CVV is never prefilled (E10.5)', () => {
  it('leaves both security codes empty even when the extraction returns them', async () => {
    server.use(
      aiStatus(true),
      secretTypes(),
      http.post(`${API_BASE}/secrets/cards/extract`, () =>
        HttpResponse.json({
          data: {
            ...EXTRACTION,
            fields: { ...EXTRACTION.fields, cvv: '999', security_code_2: '4567' },
            confidence: { ...EXTRACTION.confidence, cvv: 0.99 },
          },
        }),
      ),
    );
    render(<ImportCardPage />);
    await walkToReview();

    expect(field(/cvv/i)).toHaveValue('');
    expect(screen.getByText(/not read from the photo — type it from the card/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save card/i })).toBeDisabled();
  });
});

describe('ImportCardPage — AI-read fields are marked on the review step (E10.5)', () => {
  beforeEach(() => {
    server.use(aiStatus(true), secretTypes(), extractOk());
  });

  it('marks the fields the AI supplied, and never the CVV', async () => {
    render(<ImportCardPage />);
    await walkToReview();

    const holder = field(/cardholder name/i).closest('.MuiFormControl-root') as HTMLElement;
    expect(within(holder).getAllByLabelText('Read by AI').length).toBeGreaterThan(0);

    // The low-confidence number gets "Check" instead of the AI marker.
    const number = field(/card number/i).closest('.MuiFormControl-root') as HTMLElement;
    expect(within(number).queryAllByLabelText('Read by AI')).toHaveLength(0);

    const cvv = field(/cvv/i).closest('.MuiFormControl-root') as HTMLElement;
    expect(within(cvv).queryAllByLabelText('Read by AI')).toHaveLength(0);

    expect(screen.getByText(/were read from your photo/i)).toBeInTheDocument();
  });

  it('drops the AI marker once the user edits the field', async () => {
    const user = userEvent.setup();
    render(<ImportCardPage />);
    await walkToReview();

    await user.clear(field(/cardholder name/i));
    await user.type(field(/cardholder name/i), 'PERSON B');

    const holder = field(/cardholder name/i).closest('.MuiFormControl-root') as HTMLElement;
    expect(within(holder).queryAllByLabelText('Read by AI')).toHaveLength(0);
  });
});
