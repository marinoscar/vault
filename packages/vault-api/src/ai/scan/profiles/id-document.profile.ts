// =============================================================================
// The ID document scan profile (issue #210, IDOC-7)
// =============================================================================

import { z } from 'zod';

import {
  ID_DOCUMENT_KINDS,
  ID_DOCUMENT_KIND_CATALOG,
} from '@marinoscar/vault-contract/secret-types';
import type { ExtractDocumentResponse } from '@marinoscar/vault-contract/secrets';

import { DOCUMENT_EXTRACT_FEATURE, OPENAI_REQUEST_TIMEOUT_MS } from '../../ai.constants';
import {
  cleanText,
  DOCUMENT_MAX_ATTRIBUTES,
  ID_DOCUMENT_SCAN_FIELDS,
  normalizeIdDocumentScan,
  type RawDocumentScan,
} from '../document-normalizer';
import type { ScanProfile } from '../scan-profile';
import {
  cleanMrzLines,
  cleanWarnings,
  COMMON_DOCUMENT_RULES,
  documentBoxSchema,
  mrzLinesSchema,
  nullableString,
  repairBoxes,
  score,
  warningsSchema,
} from './document-model';

/** The ID document's registry key; permanent (the `documentType` of the route). */
export const ID_DOCUMENT_SCAN_PROFILE_ID = 'id_document';

/** The schema name sent to the provider. */
export const ID_DOCUMENT_EXTRACT_SCHEMA_NAME = 'id_document_extraction';

/** One line per kind: its standard attribute keys, from the catalog. */
const KIND_KEYS = ID_DOCUMENT_KINDS.map((kind) => {
  const keys = ID_DOCUMENT_KIND_CATALOG[kind].standardKeys.map((k) => `${k.key} (${k.label})`);
  return `- ${kind}: ${keys.length > 0 ? keys.join(', ') : 'no standard keys'}`;
});

/**
 * System prompt of the ID document scan: classify the kind first, read the core
 * fields, then the kind's standard attributes and any other printed detail.
 */
export const ID_DOCUMENT_EXTRACT_SYSTEM_PROMPT = [
  'You are an expert transcriber of identity document photographs (driver licenses, ID cards, residence and work permits, trusted traveler cards, Social Security cards, health insurance cards, visas, vehicle registrations, military and student IDs) into structured data.',
  '',
  'Rules:',
  ...COMMON_DOCUMENT_RULES.map((rule, i) => `${i + 1}. ${rule}`),
  `${COMMON_DOCUMENT_RULES.length + 1}. FIRST classify \`document_kind\` as exactly one of: ${ID_DOCUMENT_KINDS.join(', ')}. When the document prints its kind ("DRIVER LICENSE", "PERMANENT RESIDENT", "SOCIAL SECURITY", "GLOBAL ENTRY", "RESIDENCE PERMIT"...), use it with high confidence. When you infer the kind from the layout rather than printed wording, give it moderate confidence (around 0.6) and add a warning saying the kind was inferred. Use "Other" for an identity document that fits none, and null only when unsure.`,
  `${COMMON_DOCUMENT_RULES.length + 2}. Read the core fields: holder_name (the full name as printed), document_number (the main document or card number), issuing_country (ICAO three-letter code), issuing_authority (the issuing state, province or agency), date_of_birth, issue_date and expiry_date (YYYY-MM-DD).`,
  `${COMMON_DOCUMENT_RULES.length + 3}. \`attributes\`: the other details printed on the document. Use the standard keys of the chosen kind first, then add any other printed field as { key: null, label, value }. Never put the document number, the date of birth or the holder's name into attributes, and never the machine-readable zone. Standard keys per kind:`,
  ...KIND_KEYS,
  `${COMMON_DOCUMENT_RULES.length + 4}. Transcribe the machine-readable zone, if the document has one, into \`mrz_lines\` VERBATIM, one string per line, keeping every "<" filler; never correct it.`,
  `${COMMON_DOCUMENT_RULES.length + 5}. Set \`barcode_present\` to true when a PDF417 or other 2D barcode is visible on any image. Do not try to decode it.`,
].join('\n');

const attributeSchema = z.object({
  key: z.string().nullable().describe('A standard key of the chosen kind, or null for any other printed field.'),
  label: z.string().describe('The label printed next to the value, or the standard label.'),
  value: z.string().describe('The value as printed.'),
  confidence: score,
});

/** The model-facing schema of the ID document scan. */
export const idDocumentModelSchema = z.object({
  document_kind: z
    .enum(ID_DOCUMENT_KINDS as unknown as [string, ...string[]])
    .nullable()
    .describe('The kind of identity document; null only when unsure.'),
  document_kind_confidence: score,
  holder_name: nullableString('Full name of the holder as printed.'),
  document_number: nullableString('The main document or card number.'),
  issuing_country: nullableString('Issuing country, ICAO three-letter code.'),
  issuing_authority: nullableString('Issuing state, province or agency as printed.'),
  date_of_birth: nullableString('Date of birth, YYYY-MM-DD.'),
  issue_date: nullableString('Issue date, YYYY-MM-DD.'),
  expiry_date: nullableString('Expiry date, YYYY-MM-DD.'),
  attributes: z.array(attributeSchema).describe(`Other printed details, at most ${DOCUMENT_MAX_ATTRIBUTES}.`),
  mrz_lines: mrzLinesSchema,
  barcode_present: z.boolean().describe('True when a PDF417 or other 2D barcode is visible.'),
  confidence: z.object({
    ...Object.fromEntries(ID_DOCUMENT_SCAN_FIELDS.map((f) => [f, score])),
    mrz_lines: score,
  } as Record<(typeof ID_DOCUMENT_SCAN_FIELDS)[number] | 'mrz_lines', typeof score>),
  warnings: warningsSchema,
  front_box: documentBoxSchema('front'),
  back_box: documentBoxSchema('back'),
});

export type IdDocumentModelOutput = z.infer<typeof idDocumentModelSchema>;

/** Trims and caps the validated answer, clamps confidences and repairs boxes. */
export function toRawIdDocument(output: IdDocumentModelOutput, model: string): RawDocumentScan {
  const fields: Record<string, string | null> = {};
  const confidence: Record<string, number> = {};
  for (const name of ID_DOCUMENT_SCAN_FIELDS) {
    fields[name] = cleanText(output[name]);
    confidence[name] = output.confidence[name] ?? 0;
  }
  return {
    fields,
    confidence,
    documentKind: output.document_kind,
    documentKindConfidence: output.document_kind_confidence,
    attributes: (output.attributes ?? []).slice(0, DOCUMENT_MAX_ATTRIBUTES).map((a) => ({
      key: a.key,
      label: a.label,
      value: a.value,
      confidence: a.confidence,
    })),
    barcodePresent: output.barcode_present === true,
    mrzLines: cleanMrzLines(output.mrz_lines),
    mrzConfidence: output.confidence.mrz_lines ?? 0,
    warnings: cleanWarnings(output.warnings),
    boxes: repairBoxes(output, ['front', 'back']),
    model,
  };
}

/**
 * An ID document scan profile. `now` is the reference day of the MRZ date rule
 * (tests pass a fixed one).
 *
 * @stability experimental
 */
export function createIdDocumentScanProfile(
  now: () => Date = () => new Date(),
): ScanProfile<IdDocumentModelOutput, ExtractDocumentResponse> {
  return {
    id: ID_DOCUMENT_SCAN_PROFILE_ID,
    aiFeature: DOCUMENT_EXTRACT_FEATURE,
    imageSlots: [
      { key: 'front', required: true, label: 'Front of the document' },
      { key: 'back', required: false, label: 'Back of the document' },
    ],
    schemaName: ID_DOCUMENT_EXTRACT_SCHEMA_NAME,
    systemPrompt: ID_DOCUMENT_EXTRACT_SYSTEM_PROMPT,
    modelSchema: idDocumentModelSchema,
    timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
    userText: (images) =>
      images.back
        ? 'Image 1 is the FRONT of the document, image 2 is the BACK.'
        : 'Image 1 is the FRONT of the document; no back image was provided.',
    toRaw: (output, { model }) => toRawIdDocument(output, model),
    normalize: (raw, { providedSlots }) =>
      normalizeIdDocumentScan(raw as RawDocumentScan, {
        providedSlots,
        slots: ['front', 'back'],
        today: now(),
      }),
    recordOutcome: (metrics, outcome) => metrics.documentExtracted('id_document', outcome),
  };
}

/**
 * The registered ID document scan profile.
 *
 * @stability experimental
 */
export const idDocumentScanProfile = createIdDocumentScanProfile();
