// Issue #211: the "Scan an ID" page — gating, the stages for both types, the
// kind chip, and the kind change that adds suggestions and keeps entries.
// Invented values and generated stand-in files only.
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import { mockAdminUser, mockUser, render as baseRender } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import { AI_CONFIG_ON_NO_KEY, aiConfigPayload } from '../mocks/aiConfig.js';
import { cropImageFileToBox, cropImageFileToCard } from '../../src/cards/headless/cardImage.js';
import DocumentScanPage from '../../src/documents/ui/pages/DocumentScanPage.js';
import { ID1_ASPECT_RATIO, ID3_ASPECT_RATIO } from '@marinoscar/vault-contract/secrets';
import { ID_DOCUMENT_TYPE, ID_EXTRACTION, PASSPORT_EXTRACTION, PASSPORT_TYPE } from './documentFixtures.js';

const API_BASE = '*/api';

// jsdom has no canvas encoding: the canvas-touching helpers are stubbed (their
// geometry is covered by the cardImage tests).
vi.mock('../../src/cards/headless/cardImage.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/cards/headless/cardImage.js')>(
    '../../src/cards/headless/cardImage.js',
  );
  const cropped = (name: string) => ({
    dataUrl: 'data:image/jpeg;base64,CROP',
    file: new File(['cropped'], name, { type: 'image/jpeg' }),
    previewUrl: `blob:${name}`,
    width: 1250,
    height: 880,
  });
  return {
    ...actual,
    prepareCardPhoto: vi.fn(async (file: File) => ({
      dataUrl: `data:image/jpeg;base64,PREPARED${file.name.length}`,
      width: 1600,
      height: 1200,
    })),
    cropImageFileToBox: vi.fn(async (_f: File, _b: unknown, o?: { fileName?: string }) => cropped(o?.fileName ?? 'box.jpg')),
    cropImageFileToCard: vi.fn(async (_f: File, o?: { fileName?: string }) => cropped(o?.fileName ?? 'fit.jpg')),
  };
});

// The PDF417 decoder (issue #214) is mocked: no barcode unless a test says so.
const decodePdf417Image = vi.hoisted(() => vi.fn<(file: Blob) => Promise<string | null>>());
vi.mock('../../src/documents/headless/pdf417Decoder.js', () => ({ decodePdf417Image }));

vi.mock('../../src/cards/ui/components/CardCropAdjuster.js', () => ({
  CardCropAdjuster: () => null,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const SCANNER = {
  ...mockUser,
  roles: [{ name: 'contributor' }],
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'ai:use'],
};
const ADMIN = { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'ai:use', 'ai_config:read'] };

function render(ui: ReactElement, route = '/documents/scan', user = SCANNER) {
  return baseRender(ui, { wrapperOptions: { user, route } });
}

const aiStatus = (on: boolean) =>
  http.get(`${API_BASE}/ai/config`, () => HttpResponse.json({ data: aiConfigPayload(on) }));
const types = () =>
  http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [PASSPORT_TYPE, ID_DOCUMENT_TYPE] }));

function extracting(result: unknown, bodies: unknown[] = []) {
  return http.post(`${API_BASE}/secrets/documents/extract`, async ({ request }) => {
    bodies.push(await request.json());
    return HttpResponse.json({ data: result });
  });
}

function pick(slot: string) {
  fireEvent.change(screen.getByTestId(`document-${slot}-input`), {
    target: { files: [new File(['bytes'], `${slot}.png`, { type: 'image/png' })] },
  });
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  decodePdf417Image.mockResolvedValue(null);
});

describe('DocumentScanPage — gating', () => {
  it('says AI is off and offers to add the document manually with its type preselected', async () => {
    server.use(aiStatus(false), types());
    render(<DocumentScanPage />);
    expect(await screen.findByText('AI is off')).toBeInTheDocument();
    expect(screen.queryByTestId('document-front-input')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open console → ai/i })).not.toBeInTheDocument();

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add manually' }));
      expect(mockNavigate).toHaveBeenLastCalledWith('/secrets/new?type=type-id-document');
    });
  });

  it('says AI is not set up yet when the key is missing, and points an admin at Console → AI', async () => {
    server.use(http.get(`${API_BASE}/ai/config`, () => HttpResponse.json({ data: AI_CONFIG_ON_NO_KEY })), types());
    render(<DocumentScanPage />, '/documents/scan', ADMIN);
    expect(await screen.findByText('AI is not set up yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open console → ai/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/settings/ai');
  });

  it('tells a viewer without ai:use that scanning is not available', async () => {
    server.use(aiStatus(true), types());
    render(<DocumentScanPage />, '/documents/scan', mockUser);
    expect(await screen.findByText('Document scanning is not available to you')).toBeInTheDocument();
  });
});

describe('DocumentScanPage — ID document', () => {
  it('captures the front and the optional back, reads them and reviews the details', async () => {
    const bodies: unknown[] = [];
    server.use(
      aiStatus(true),
      types(),
      extracting({ ...ID_EXTRACTION, crops: { front: { x: 0.1, y: 0.1, width: 0.8, height: 0.5, quarterTurns: 0, confidence: 0.9 }, back: null } }, bodies),
      http.post(`${API_BASE}/secrets`, () => HttpResponse.json({ data: { id: 'secret-9' } })),
      http.post(`${API_BASE}/storage/objects`, () => HttpResponse.json({ data: { id: 'object-1' } })),
      http.post(`${API_BASE}/secrets/:id/attachments`, () => HttpResponse.json({ data: { id: 'a' } })),
    );
    render(<DocumentScanPage />);

    expect(await screen.findByRole('note', { name: /document photos will be sent to OpenAI/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ID document' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Photograph the front of the document' })).toBeInTheDocument();
    pick('front');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: /back of the document \(optional\)/ })).toBeInTheDocument();
    pick('back');
    fireEvent.click(await screen.findByRole('button', { name: 'Read the document' }));

    expect(await screen.findByRole('heading', { name: 'Check the crop' })).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        documentType: 'id_document',
        images: { front: 'data:image/jpeg;base64,PREPARED9', back: 'data:image/jpeg;base64,PREPARED8' },
      },
    ]);
    // The front was cropped from the AI's box, the back auto-fitted, both at ID-1.
    expect(vi.mocked(cropImageFileToBox).mock.calls[0][2]).toMatchObject({ aspectRatio: ID1_ASPECT_RATIO });
    expect(vi.mocked(cropImageFileToCard).mock.calls[0][1]).toMatchObject({ aspectRatio: ID1_ASPECT_RATIO });

    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));
    expect(await screen.findByRole('heading', { name: 'Check the details' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Driver License · PERSON');
    expect(await screen.findByText('AI guessed · 92%')).toBeInTheDocument();
    expect(screen.getByText('The back photo was blurry.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/secrets/secret-9'));
  });

  it('decodes the back photo’s barcode and sends only its parsed values (issue #214)', async () => {
    // Invented: Person A, a made-up number, the placeholder jurisdiction ZZ.
    decodePdf417Image.mockResolvedValue('@\n\u001e\rANSI 999999100002DL00410278DLDAQX1234567\nDCSA\nDACPERSON\nDAJZZ\nDCGUSA\r');
    const bodies: unknown[] = [];
    server.use(aiStatus(true), types(), extracting({ ...ID_EXTRACTION, barcodePresent: true }, bodies));
    render(<DocumentScanPage />);

    expect(await screen.findByRole('heading', { name: 'Photograph the front of the document' })).toBeInTheDocument();
    pick('front');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    pick('back');
    fireEvent.click(await screen.findByRole('button', { name: 'Read the document' }));
    expect(await screen.findByRole('heading', { name: 'Check the crop' })).toBeInTheDocument();

    // The ORIGINAL back file, never a crop.
    expect(decodePdf417Image).toHaveBeenCalledTimes(1);
    expect((decodePdf417Image.mock.calls[0][0] as File).name).toBe('back.png');
    expect(bodies).toEqual([
      {
        documentType: 'id_document',
        images: { front: 'data:image/jpeg;base64,PREPARED9', back: 'data:image/jpeg;base64,PREPARED8' },
        barcode: { format: 'aamva', fields: { documentNumber: 'X1234567', familyName: 'A', givenNames: 'PERSON', state: 'ZZ', country: 'USA' } },
      },
    ]);
    expect(JSON.stringify(bodies)).not.toContain('ANSI');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));
    expect(await screen.findByRole('heading', { name: 'Check the details' })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't read the barcode/)).not.toBeInTheDocument();
  });

  it('suggests a retake when the model saw a barcode the browser could not read, dismissibly', async () => {
    const bodies: unknown[] = [];
    server.use(aiStatus(true), types(), extracting({ ...ID_EXTRACTION, barcodePresent: true }, bodies));
    render(<DocumentScanPage />);

    expect(await screen.findByRole('heading', { name: 'Photograph the front of the document' })).toBeInTheDocument();
    pick('front');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    pick('back');
    fireEvent.click(await screen.findByRole('button', { name: 'Read the document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to details' }));

    const hint = await screen.findByText(
      "Couldn't read the barcode. Retake the back photo closer and in focus to double-check the values.",
    );
    expect(bodies[0]).not.toHaveProperty('barcode');
    fireEvent.click(within(hint.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByText(/Couldn't read the barcode/)).not.toBeInTheDocument());
  });

  it('adds the new kind’s suggestions on a kind change and keeps the entered details', async () => {
    const user = userEvent.setup();
    server.use(aiStatus(true), types(), extracting(ID_EXTRACTION));
    render(<DocumentScanPage />);

    await screen.findByRole('heading', { name: 'Photograph the front of the document' });
    pick('front');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip the back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to details' }));
    await screen.findByText('AI guessed · 92%');

    // Driver License suggestions not yet present are offered.
    expect(screen.getByText('Add: Endorsements')).toBeInTheDocument();
    expect(screen.queryByText('Add: Nationality')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /Document Kind/ }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'National ID' }));

    expect(await screen.findByText('Add: Nationality')).toBeInTheDocument();
    expect(screen.queryByText('Add: Endorsements')).not.toBeInTheDocument();
    // The entries read from the photo are still there.
    expect(screen.getByLabelText('Value of Class')).toHaveValue('C');
    expect(screen.getByLabelText('Value of Restrictions')).toHaveValue('NONE');
    // No longer the AI's guess.
    expect(screen.queryByText(/AI guessed/)).not.toBeInTheDocument();
  });

  it('lands on review with the photos kept when the read fails', async () => {
    server.use(
      aiStatus(true),
      types(),
      http.post(`${API_BASE}/secrets/documents/extract`, () =>
        HttpResponse.json({ message: 'x', code: 'AI_EXTRACTION_FAILED' }, { status: 422 }),
      ),
    );
    render(<DocumentScanPage />);
    await screen.findByRole('heading', { name: 'Photograph the front of the document' });
    pick('front');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip the back' }));
    expect(await screen.findByText(/could not be read automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));
    expect(await screen.findByText('The document could not be read')).toBeInTheDocument();
  });
});

describe('DocumentScanPage — passport', () => {
  it('captures the data page from ?type=passport and reads it as a passport', async () => {
    const bodies: unknown[] = [];
    server.use(aiStatus(true), types(), extracting(PASSPORT_EXTRACTION, bodies));
    render(<DocumentScanPage />, '/documents/scan?type=passport');

    expect(await screen.findByRole('button', { name: 'Passport' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Photograph the data page of the passport' })).toBeInTheDocument();
    pick('data_page');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip the other page' }));

    await screen.findByRole('heading', { name: 'Check the crop' });
    expect(bodies).toEqual([{ documentType: 'passport', images: { data_page: 'data:image/jpeg;base64,PREPARED13' } }]);
    expect(vi.mocked(cropImageFileToCard).mock.calls[0][1]).toMatchObject({ aspectRatio: ID3_ASPECT_RATIO });

    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));
    await screen.findByRole('heading', { name: 'Check the details' });
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Passport · Utopia (ICAO specimen state)');
    expect(screen.getByText(/machine readable zone did not pass/)).toBeInTheDocument();
    expect(screen.queryByText(/AI guessed/)).not.toBeInTheDocument();
  });

  it('switches type with the toggle, resetting the capture', async () => {
    server.use(aiStatus(true), types());
    render(<DocumentScanPage />);
    await screen.findByRole('heading', { name: 'Photograph the front of the document' });
    pick('front');
    await screen.findByRole('button', { name: 'Continue' });

    fireEvent.click(screen.getByRole('button', { name: 'Passport' }));
    expect(await screen.findByRole('heading', { name: 'Photograph the data page of the passport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /take a photo of the data page/i })).toBeInTheDocument();
  });
});
