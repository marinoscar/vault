import { z } from 'zod';

import { DOCUMENT_CHECK_IDS, ID_DOCUMENT_KINDS, keyValueEntrySchema } from '../secret-types/index.js';

// =============================================================================
// AI document scanning: POST /api/secrets/documents/extract (issue #210, IDOC-7)
// =============================================================================

/**
 * Longest base64 data URL accepted for one scanned photo (about 4.5 MB of
 * image). Shared by the card and document scan routes; two must fit in the
 * API's 16 MiB body limit.
 *
 * @stability experimental
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;

/**
 * One full (uncropped) photo as a base64 data URL: JPEG, PNG or WebP, at most
 * {@link MAX_IMAGE_DATA_URL_LENGTH} characters.
 *
 * @stability experimental
 */
export const scanImageDataUrlSchema = z
  .string()
  // The length bound first: the pattern scan of a multi-megabyte string is the slow part.
  .max(MAX_IMAGE_DATA_URL_LENGTH, { abort: true })
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

/**
 * The system types the document scan reads: `passport` (the Passport type) and
 * `id_document` (the ID Document type). Permanent once shipped.
 *
 * @stability experimental
 */
export const SCANNABLE_DOCUMENT_TYPES = ['passport', 'id_document'] as const;

/** @stability experimental */
export type ScannableDocumentType = (typeof SCANNABLE_DOCUMENT_TYPES)[number];

/** The image slots of a document scan. @stability experimental */
export const DOCUMENT_SCAN_SLOTS = ['data_page', 'front', 'back'] as const;

/** @stability experimental */
export type DocumentScanSlot = (typeof DOCUMENT_SCAN_SLOTS)[number];

/**
 * Body of `POST /api/secrets/documents/extract`. A passport needs `data_page`
 * and has no `front`; an ID document needs `front` and has no `data_page`;
 * `back` is optional for both.
 *
 * @stability experimental
 */
export const extractDocumentRequestSchema = z
  .object({
    documentType: z.enum(SCANNABLE_DOCUMENT_TYPES),
    images: z.object({
      data_page: scanImageDataUrlSchema.optional(),
      front: scanImageDataUrlSchema.optional(),
      back: scanImageDataUrlSchema.optional(),
    }),
  })
  .superRefine((body, ctx) => {
    const issue = (slot: DocumentScanSlot, message: string) =>
      ctx.addIssue({ code: 'custom', path: ['images', slot], message });
    if (body.documentType === 'passport') {
      if (!body.images.data_page) issue('data_page', 'A passport scan needs the data page');
      if (body.images.front) issue('front', 'A passport scan has no front image');
    } else {
      if (!body.images.front) issue('front', 'An ID document scan needs the front');
      if (body.images.data_page) issue('data_page', 'An ID document scan has no data page');
    }
  });

/** @stability experimental */
export type ExtractDocumentRequest = z.infer<typeof extractDocumentRequestSchema>;

/**
 * Where the model found the document in one image, as fractions (0-1) of the
 * image as sent, with the clockwise quarter turns that make it upright.
 *
 * @stability experimental
 */
export const scanCropBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  quarterTurns: z.number().int().min(0).max(3),
  confidence: z.number().min(0).max(1),
});

/** @stability experimental */
export type ScanCropBoxWire = z.infer<typeof scanCropBoxSchema>;

/**
 * One `attributes` entry the scan read, with the model's confidence.
 *
 * @stability experimental
 */
export const scannedAttributeSchema = keyValueEntrySchema.extend({
  confidence: z.number().min(0).max(1),
});

/** @stability experimental */
export type ScannedAttribute = z.infer<typeof scannedAttributeSchema>;

/**
 * The outcome of one deterministic check (`mrz`, `ssn`, `vin`): `failed` names
 * the fields that did not pass, never their values.
 *
 * @stability experimental
 */
export const documentCheckResultSchema = z.object({
  id: z.enum(DOCUMENT_CHECK_IDS),
  ok: z.boolean(),
  failed: z.array(z.string()),
});

/** @stability experimental */
export type DocumentCheckResult = z.infer<typeof documentCheckResultSchema>;

/**
 * The `data` of `POST /api/secrets/documents/extract`: candidate values for
 * the review form. Nothing is persisted.
 *
 * - `fields`: the typed fields of the target type (never `attributes`).
 * - `documentKind`: the classified kind (ID document only; `null` for a passport).
 * - `attributes`: kind-specific details (ID document only; `[]` for a passport).
 * - `crops`: one box per provided image, `null` when absent or no document was found.
 * - `partial`: the call succeeded but every typed field is null.
 *
 * @stability experimental
 */
export const extractDocumentResponseSchema = z.object({
  documentType: z.enum(SCANNABLE_DOCUMENT_TYPES),
  fields: z.record(z.string(), z.string().nullable()),
  confidence: z.record(z.string(), z.number().min(0).max(1)),
  documentKind: z
    .object({ value: z.enum(ID_DOCUMENT_KINDS).nullable(), confidence: z.number().min(0).max(1) })
    .nullable(),
  attributes: z.array(scannedAttributeSchema),
  checks: z.array(documentCheckResultSchema),
  warnings: z.array(z.string()),
  crops: z.partialRecord(z.enum(DOCUMENT_SCAN_SLOTS), scanCropBoxSchema.nullable()),
  model: z.string().nullable(),
  partial: z.boolean(),
});

/** @stability experimental */
export type ExtractDocumentResponse = z.infer<typeof extractDocumentResponseSchema>;
