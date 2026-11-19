import { AiError } from '@marinoscar/platform-api/ai';
import { RequestUser } from '@marinoscar/platform-api/identity';
import { extractDocumentResponseSchema, MAX_IMAGE_DATA_URL_LENGTH } from '@marinoscar/vault-contract/secrets';

import { AI_ERROR_CODES, DOCUMENT_EXTRACT_FEATURE } from './ai.constants';
import { AiException } from './ai.errors';
import { DocumentExtractService } from './document-extract.service';
import { CountingMetrics } from '../testing';
import { ID_DOCUMENT_EXTRACT_SYSTEM_PROMPT } from './scan/profiles/id-document.profile';
import { PASSPORT_EXTRACT_SYSTEM_PROMPT } from './scan/profiles/passport.profile';
import { createScanProfileRegistry } from './scan/scan-profile.registry';

// Invented fixtures only: the ICAO specimen state UTO and placeholder image bytes.
const PAGE = `data:image/jpeg;base64,${Buffer.from('PAGE-IMAGE-MARKER').toString('base64')}`;
const BACK = `data:image/png;base64,${Buffer.from('BACK-IMAGE-MARKER').toString('base64')}`;

const user: RequestUser = {
  id: 'user-aaa',
  email: 'person.a@example.test',
  roles: ['contributor'],
  permissions: ['secrets:write', 'ai:use'],
  isActive: true,
  activeOrgId: 'org-alpha',
};

const box = { x: 0, y: 0, width: 1, height: 1, quarter_turns: 0, confidence: 0.9 };
const zero = (names: string[]) => Object.fromEntries(names.map((n) => [n, 0]));

const PASSPORT_ANSWER = {
  surname: 'ERIKSSON',
  given_names: 'ANNA MARIA',
  passport_number: 'L898902C3',
  passport_type: 'P',
  issuing_country: 'UTO',
  nationality: 'UTO',
  date_of_birth: '1974-08-12',
  place_of_birth: null,
  sex: 'F',
  issue_date: null,
  expiry_date: '2012-04-15',
  issuing_authority: null,
  personal_number: null,
  mrz_lines: ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'],
  confidence: { ...zero(['place_of_birth', 'issue_date', 'issuing_authority', 'personal_number']), surname: 0.9, given_names: 0.9, passport_number: 0.9, passport_type: 0.9, issuing_country: 0.9, nationality: 0.9, date_of_birth: 0.9, sex: 0.9, expiry_date: 0.9, mrz_lines: 0.9 },
  warnings: [],
  data_page_box: box,
  back_box: box,
};

const ID_ANSWER = {
  document_kind: 'Driver License',
  document_kind_confidence: 0.95,
  holder_name: 'Person A',
  document_number: 'D0000000',
  issuing_country: 'UTO',
  issuing_authority: 'Utopia DMV',
  date_of_birth: null,
  issue_date: null,
  expiry_date: null,
  attributes: [{ key: 'license_class', label: 'Class', value: 'C', confidence: 0.9 }],
  mrz_lines: null,
  barcode_present: true,
  confidence: { holder_name: 0.9, document_number: 0.9, issuing_country: 0.9, issuing_authority: 0.9, date_of_birth: 0, issue_date: 0, expiry_date: 0, mrz_lines: 0 },
  warnings: [],
  front_box: box,
  back_box: null,
};

async function rejection(promise: Promise<unknown>): Promise<AiException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiException);
    return error as AiException;
  }
  throw new Error('Expected the call to reject');
}

describe('DocumentExtractService', () => {
  let respondStructured: jest.Mock;
  let forUser: jest.Mock;
  let metrics: CountingMetrics;
  let service: DocumentExtractService;

  beforeEach(() => {
    respondStructured = jest.fn().mockResolvedValue({ parsed: PASSPORT_ANSWER, model: 'model-a' });
    forUser = jest.fn().mockReturnValue({ respondStructured });
    metrics = new CountingMetrics();
    service = new DocumentExtractService({ forUser } as never, metrics);
  });

  it('registers the passport and id_document profiles beside the card', () => {
    const ids = createScanProfileRegistry().list().map((p) => p.id);
    expect(ids).toEqual(['card', 'passport', 'id_document']);
    for (const profile of createScanProfileRegistry().list().slice(1)) {
      expect(profile.aiFeature).toBe('document_extract');
      expect(profile.timeoutMs).toBe(90_000);
    }
  });

  it('scans a passport under the document_extract feature, data page first', async () => {
    const result = await service.extract({ documentType: 'passport', images: { back: BACK, data_page: PAGE } }, user);

    expect(DOCUMENT_EXTRACT_FEATURE).toBe('document_extract');
    expect(forUser).toHaveBeenCalledWith('user-aaa', { orgId: 'org-alpha', feature: 'document_extract' });
    const [req] = respondStructured.mock.calls[0];
    expect(req.schemaName).toBe('passport_extraction');
    expect(req.instructions).toBe(PASSPORT_EXTRACT_SYSTEM_PROMPT);
    expect(req.input[0].content.filter((p: { type: string }) => p.type === 'image').map((p: { url: string }) => p.url)).toEqual([PAGE, BACK]);

    expect(extractDocumentResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ documentType: 'passport', model: 'model-a', partial: false });
    expect(result.fields.mrz).toBe(PASSPORT_ANSWER.mrz_lines.join('\n'));
    expect(result.checks).toEqual([{ id: 'mrz', ok: true, failed: [] }]);
    expect(result.crops).toEqual({ data_page: expect.any(Object), back: expect.any(Object) });
    expect(metrics.calls).toEqual([{ method: 'documentExtracted', args: ['passport', 'succeeded'] }]);
  });

  it('scans an ID document: the kind, the attributes, and no back box without a back image', async () => {
    respondStructured.mockResolvedValue({ parsed: ID_ANSWER, model: 'model-a' });
    const result = await service.extract({ documentType: 'id_document', images: { front: PAGE } }, user);

    const [req] = respondStructured.mock.calls[0];
    expect(req.schemaName).toBe('id_document_extraction');
    expect(req.instructions).toBe(ID_DOCUMENT_EXTRACT_SYSTEM_PROMPT);
    expect(req.instructions).toContain('Health Insurance Card: member_id (Member ID)');
    expect(result.documentKind).toEqual({ value: 'Driver License', confidence: 0.95 });
    expect(result.attributes).toEqual([{ key: 'license_class', label: 'Class', value: 'C', sensitive: false, confidence: 0.9 }]);
    expect(result.crops).toEqual({ front: expect.any(Object), back: null });
    expect(metrics.calls).toEqual([{ method: 'documentExtracted', args: ['id_document', 'succeeded'] }]);
  });

  it('cross-checks a decoded AAMVA barcode in the normalizer, and never sends it to the model (issue #214)', async () => {
    respondStructured.mockResolvedValue({ parsed: ID_ANSWER, model: 'model-a' });
    // Invented: a made-up license number and the placeholder state ZZ.
    const barcode = { format: 'aamva', fields: { documentNumber: 'X1234567', state: 'ZZ', licenseClass: 'C' } };
    const result = await service.extract(
      { documentType: 'id_document', images: { front: PAGE, back: BACK }, barcode },
      user,
    );

    expect(JSON.stringify(respondStructured.mock.calls[0][0])).not.toContain('X1234567');
    expect(result.fields.document_number).toBe('X1234567');
    expect(result.fields.issuing_authority).toBe('ZZ');
    expect(result.checks).toEqual([{ id: 'aamva', ok: false, failed: ['document_number', 'issuing_authority'] }]);
    expect(result.barcodePresent).toBe(true);
  });

  describe('slot and body validation (AI_INVALID_IMAGE, as for cards)', () => {
    it.each([
      ['a passport without data_page', { documentType: 'passport', images: { back: BACK } }, 'images.data_page'],
      ['a passport with a front', { documentType: 'passport', images: { data_page: PAGE, front: PAGE } }, 'images.front'],
      ['an ID document without front', { documentType: 'id_document', images: { back: BACK } }, 'images.front'],
      ['an ID document with a data page', { documentType: 'id_document', images: { front: PAGE, data_page: PAGE } }, 'images.data_page'],
      ['not an image', { documentType: 'passport', images: { data_page: 'data:text/plain;base64,QUJD' } }, 'images.data_page'],
      ['an oversize image', { documentType: 'passport', images: { data_page: `data:image/jpeg;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}` } }, 'images.data_page'],
      ['an unknown document type', { documentType: 'card', images: { front: PAGE } }, 'documentType'],
      ['no body', null, 'body'],
    ])('refuses %s', async (_name, body, path) => {
      const err = await rejection(service.extract(body, user));
      expect(err.getStatus()).toBe(400);
      expect(err.code).toBe(AI_ERROR_CODES.INVALID_IMAGE);
      expect(err.message).toContain(path);
      expect(err.message).not.toContain('base64');
      expect(respondStructured).not.toHaveBeenCalled();
    });

    it('counts an invalid body under its document type, and an unknown type not at all', async () => {
      await rejection(service.extract({ documentType: 'passport', images: {} }, user));
      await rejection(service.extract({ documentType: 'card', images: {} }, user));
      expect(metrics.calls).toEqual([{ method: 'documentExtracted', args: ['passport', 'invalid_image'] }]);
    });
  });

  it.each([
    [new AiError('AI_DISABLED', 'x'), AI_ERROR_CODES.NOT_CONFIGURED, 503, 'not_configured'],
    [new AiError('AI_RATE_LIMITED', 'x', { retryAfterMs: 90_000, details: { limit: 'perUser.requestsPerDay' } }), AI_ERROR_CODES.QUOTA_EXCEEDED, 429, 'quota_exceeded'],
    [new AiError('AI_STRUCTURED_OUTPUT_INVALID', 'x'), AI_ERROR_CODES.EXTRACTION_FAILED, 422, 'failed'],
    [new AiError('AI_KEY_INVALID', 'x'), AI_ERROR_CODES.UPSTREAM_AUTH, 502, 'upstream_error'],
  ])('maps AI errors as for cards (%#)', async (error, code, status, outcome) => {
    respondStructured.mockRejectedValue(error);
    const err = await rejection(service.extract({ documentType: 'id_document', images: { front: PAGE } }, user));
    expect(err.code).toBe(code);
    expect(err.getStatus()).toBe(status);
    expect(metrics.calls).toEqual([{ method: 'documentExtracted', args: ['id_document', outcome] }]);
  });

  it('works without a metrics port', async () => {
    const bare = new DocumentExtractService({ forUser } as never);
    await expect(bare.extract({ documentType: 'passport', images: { data_page: PAGE } }, user)).resolves.toMatchObject({
      documentType: 'passport',
    });
  });
});
