import { describe, expect, it } from 'vitest';

import {
  AAMVA_BARCODE_FIELDS,
  DOCUMENT_BARCODE_FIELD_MAX_LENGTH,
  MAX_IMAGE_DATA_URL_LENGTH,
  SCANNABLE_DOCUMENT_TYPES,
  extractDocumentRequestSchema,
  extractDocumentResponseSchema,
} from '../src/secrets/index.js';

// Placeholder image bytes only.
const IMG = 'data:image/jpeg;base64,QUJD';

const paths = (body: unknown): string[] => {
  const result = extractDocumentRequestSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('extractDocumentRequestSchema', () => {
  it('names the two scannable types', () => {
    expect(SCANNABLE_DOCUMENT_TYPES).toEqual(['passport', 'id_document']);
    expect(MAX_IMAGE_DATA_URL_LENGTH).toBe(6_000_000);
  });

  it('accepts a passport with its data page and an ID document with its front, back optional', () => {
    expect(paths({ documentType: 'passport', images: { data_page: IMG } })).toEqual([]);
    expect(paths({ documentType: 'passport', images: { data_page: IMG, back: IMG } })).toEqual([]);
    expect(paths({ documentType: 'id_document', images: { front: IMG, back: IMG } })).toEqual([]);
  });

  it('enforces the slots of each type', () => {
    expect(paths({ documentType: 'passport', images: { back: IMG } })).toEqual(['images.data_page']);
    expect(paths({ documentType: 'passport', images: { data_page: IMG, front: IMG } })).toEqual(['images.front']);
    expect(paths({ documentType: 'id_document', images: {} })).toEqual(['images.front']);
    expect(paths({ documentType: 'id_document', images: { front: IMG, data_page: IMG } })).toEqual(['images.data_page']);
  });

  it('refuses anything but a JPEG, PNG or WebP data URL within the length bound', () => {
    expect(paths({ documentType: 'passport', images: { data_page: 'data:image/gif;base64,QUJD' } })).toContain('images.data_page');
    expect(
      paths({ documentType: 'passport', images: { data_page: `data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}` } }),
    ).toContain('images.data_page');
    expect(paths({ documentType: 'card', images: { front: IMG } })).toContain('documentType');
  });
});

describe('extractDocumentRequestSchema barcode (issue #214)', () => {
  // Invented values only: Person A, a made-up number, the placeholder state ZZ.
  const barcode = {
    format: 'aamva',
    fields: {
      documentNumber: 'X1234567',
      familyName: 'A',
      givenNames: 'PERSON',
      birthDate: '1990-01-31',
      expiryDate: '2030-01-31',
      issueDate: '2022-01-31',
      state: 'ZZ',
      country: 'USA',
      sex: 'F',
      licenseClass: 'C',
      restrictions: 'NONE',
      endorsements: 'NONE',
    },
  };
  const body = (b: unknown) => ({ documentType: 'id_document', images: { front: IMG, back: IMG }, barcode: b });

  it('is optional, and every field inside it is optional', () => {
    expect(paths({ documentType: 'id_document', images: { front: IMG } })).toEqual([]);
    expect(paths(body(barcode))).toEqual([]);
    expect(paths(body({ format: 'aamva', fields: {} }))).toEqual([]);
    expect(AAMVA_BARCODE_FIELDS).toEqual(Object.keys(barcode.fields));
  });

  it('caps every field at 200 characters', () => {
    expect(DOCUMENT_BARCODE_FIELD_MAX_LENGTH).toBe(200);
    for (const name of AAMVA_BARCODE_FIELDS) {
      const at = { format: 'aamva', fields: { [name]: 'A'.repeat(200) } };
      const over = { format: 'aamva', fields: { [name]: 'A'.repeat(201) } };
      expect(paths(body(at))).toEqual([]);
      expect(paths(body(over))).toEqual([`barcode.fields.${name}`]);
    }
  });

  it('refuses another format or a non-string value', () => {
    expect(paths(body({ ...barcode, format: 'qr' }))).toEqual(['barcode.format']);
    expect(paths(body({ format: 'aamva', fields: { documentNumber: 1234 } }))).toEqual(['barcode.fields.documentNumber']);
    expect(paths(body({ format: 'aamva' }))).toEqual(['barcode.fields']);
  });

  it('strips anything else, so a raw barcode string never passes through', () => {
    const parsed = extractDocumentRequestSchema.parse(
      body({ ...barcode, raw: '@ANSI 636000', fields: { ...barcode.fields, raw: '@ANSI 636000' } }),
    );
    expect(parsed.barcode).toEqual(barcode);
    expect(JSON.stringify(parsed)).not.toContain('ANSI');
  });
});

describe('extractDocumentResponseSchema', () => {
  it('accepts an ID document answer and refuses an unknown kind or check', () => {
    const answer = {
      documentType: 'id_document',
      fields: { holder_name: 'Person A', document_number: null },
      confidence: { holder_name: 0.9, document_number: 0 },
      documentKind: { value: 'Driver License', confidence: 0.9 },
      attributes: [{ key: 'license_class', label: 'Class', value: 'C', sensitive: false, confidence: 0.8 }],
      checks: [{ id: 'mrz', ok: false, failed: ['document_number'] }],
      warnings: [],
      crops: { front: { x: 0, y: 0, width: 1, height: 1, quarterTurns: 0, confidence: 1 }, back: null },
      model: 'model-a',
      partial: false,
    };
    expect(extractDocumentResponseSchema.parse(answer)).toEqual(answer);
    expect(extractDocumentResponseSchema.safeParse({ ...answer, documentKind: { value: 'Library Card', confidence: 1 } }).success).toBe(false);
    expect(extractDocumentResponseSchema.safeParse({ ...answer, checks: [{ id: 'luhn', ok: true, failed: [] }] }).success).toBe(false);
  });

  it('accepts the aamva check and the optional barcodePresent flag (issue #214)', () => {
    const base = {
      documentType: 'id_document',
      fields: {},
      confidence: {},
      documentKind: { value: 'Driver License', confidence: 0.9 },
      attributes: [],
      checks: [{ id: 'aamva', ok: false, failed: ['document_number'] }],
      warnings: [],
      crops: {},
      model: null,
      partial: true,
    };
    expect(extractDocumentResponseSchema.safeParse(base).success).toBe(true);
    expect(extractDocumentResponseSchema.parse({ ...base, barcodePresent: true }).barcodePresent).toBe(true);
  });
});
