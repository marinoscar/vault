import { describe, expect, it } from 'vitest';

import {
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
});
