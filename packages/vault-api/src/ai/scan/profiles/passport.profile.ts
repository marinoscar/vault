// =============================================================================
// The passport scan profile (issue #210, IDOC-7)
// =============================================================================

import { z } from 'zod';

import type { ExtractDocumentResponse } from '@marinoscar/vault-contract/secrets';

import { DOCUMENT_EXTRACT_FEATURE, OPENAI_REQUEST_TIMEOUT_MS } from '../../ai.constants';
import {
  cleanText,
  normalizePassportScan,
  PASSPORT_SCAN_FIELDS,
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

/** The passport's registry key; permanent (the `documentType` of the route). */
export const PASSPORT_SCAN_PROFILE_ID = 'passport';

/** The schema name sent to the provider. */
export const PASSPORT_EXTRACT_SCHEMA_NAME = 'passport_extraction';

/** The fields the model reads (the typed fields but `mrz`, which is built from `mrz_lines`). */
const MODEL_FIELDS = PASSPORT_SCAN_FIELDS.filter((f) => f !== 'mrz');

/**
 * System prompt of the passport scan. Best guess, the human decides; the MRZ is
 * transcribed verbatim so its check digits can be verified server-side.
 */
export const PASSPORT_EXTRACT_SYSTEM_PROMPT = [
  'You are an expert transcriber of passport photographs into structured data.',
  '',
  'Layout knowledge - use it to know where to look:',
  '- The data page carries a visual inspection zone (photo, printed labels and values, often bilingual) and, at the bottom, the machine-readable zone (MRZ): two lines of exactly 44 characters made of A-Z, 0-9 and the "<" filler.',
  '- The first MRZ line starts with "P", then the issuing state code and the names (surname, "<<", given names); the second carries the passport number, check digits, nationality, date of birth, sex and expiry date.',
  '- The optional second image is another page of the passport (an observations page or the back cover).',
  '',
  'Rules:',
  ...COMMON_DOCUMENT_RULES.map((rule, i) => `${i + 1}. ${rule}`),
  `${COMMON_DOCUMENT_RULES.length + 1}. Transcribe the MRZ into \`mrz_lines\` VERBATIM, one string per line, keeping every "<" filler and every character exactly as printed; never correct it. Read the visual zone independently of the MRZ.`,
  `${COMMON_DOCUMENT_RULES.length + 2}. Dates (date_of_birth, issue_date, expiry_date) as YYYY-MM-DD.`,
  `${COMMON_DOCUMENT_RULES.length + 3}. issuing_country and nationality as the ICAO three-letter code printed on the page (for example the code in the MRZ or next to "Code"/"Nationality").`,
  `${COMMON_DOCUMENT_RULES.length + 4}. sex as M, F or X.`,
  `${COMMON_DOCUMENT_RULES.length + 5}. surname and given_names as printed in the visual zone, with their accents; passport_type is the document type code (usually "P").`,
].join('\n');

/** The model-facing schema of the passport scan. */
export const passportModelSchema = z.object({
  surname: nullableString('Surname as printed in the visual zone.'),
  given_names: nullableString('Given names as printed in the visual zone.'),
  passport_number: nullableString('Passport number as printed.'),
  passport_type: nullableString('Document type code, usually "P".'),
  issuing_country: nullableString('Issuing state, ICAO three-letter code.'),
  nationality: nullableString('Nationality, ICAO three-letter code.'),
  date_of_birth: nullableString('Date of birth, YYYY-MM-DD.'),
  place_of_birth: nullableString('Place of birth as printed.'),
  sex: nullableString('M, F or X.'),
  issue_date: nullableString('Date of issue, YYYY-MM-DD.'),
  expiry_date: nullableString('Date of expiry, YYYY-MM-DD.'),
  issuing_authority: nullableString('Issuing authority as printed.'),
  personal_number: nullableString('Personal number as printed, when the page has one.'),
  mrz_lines: mrzLinesSchema,
  confidence: z.object({
    ...Object.fromEntries(MODEL_FIELDS.map((f) => [f, score])),
    mrz_lines: score,
  } as Record<(typeof MODEL_FIELDS)[number] | 'mrz_lines', typeof score>),
  warnings: warningsSchema,
  data_page_box: documentBoxSchema('data page'),
  back_box: documentBoxSchema('second'),
});

export type PassportModelOutput = z.infer<typeof passportModelSchema>;

/** Trims and caps the validated answer, clamps confidences and repairs boxes. */
export function toRawPassport(output: PassportModelOutput, model: string): RawDocumentScan {
  const fields: Record<string, string | null> = {};
  const confidence: Record<string, number> = {};
  for (const name of MODEL_FIELDS) {
    fields[name] = cleanText(output[name]);
    confidence[name] = output.confidence[name] ?? 0;
  }
  return {
    fields,
    confidence,
    mrzLines: cleanMrzLines(output.mrz_lines),
    mrzConfidence: output.confidence.mrz_lines ?? 0,
    warnings: cleanWarnings(output.warnings),
    boxes: repairBoxes(output, ['data_page', 'back']),
    model,
  };
}

/**
 * A passport scan profile. `now` is the reference day of the MRZ date rule
 * (tests pass a fixed one).
 *
 * @stability experimental
 */
export function createPassportScanProfile(
  now: () => Date = () => new Date(),
): ScanProfile<PassportModelOutput, ExtractDocumentResponse> {
  return {
    id: PASSPORT_SCAN_PROFILE_ID,
    aiFeature: DOCUMENT_EXTRACT_FEATURE,
    imageSlots: [
      { key: 'data_page', required: true, label: 'Passport data page' },
      { key: 'back', required: false, label: 'Another passport page' },
    ],
    schemaName: PASSPORT_EXTRACT_SCHEMA_NAME,
    systemPrompt: PASSPORT_EXTRACT_SYSTEM_PROMPT,
    modelSchema: passportModelSchema,
    timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
    userText: (images) =>
      images.back
        ? 'Image 1 is the passport DATA PAGE, image 2 is another page of the same passport.'
        : 'Image 1 is the passport DATA PAGE; no other page was provided.',
    toRaw: (output, { model }) => toRawPassport(output, model),
    normalize: (raw, { providedSlots }) =>
      normalizePassportScan(raw as RawDocumentScan, {
        providedSlots,
        slots: ['data_page', 'back'],
        today: now(),
      }),
    recordOutcome: (metrics, outcome) => metrics.documentExtracted('passport', outcome),
  };
}

/**
 * The registered passport scan profile.
 *
 * @stability experimental
 */
export const passportScanProfile = createPassportScanProfile();
