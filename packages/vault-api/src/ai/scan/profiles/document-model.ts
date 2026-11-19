// =============================================================================
// Shared pieces of the identity-document scan profiles (issue #210, IDOC-7)
// =============================================================================
// The model-facing schema parts and the repair step the passport and ID
// document profiles share. The semantics (dates, countries, MRZ, checks) are
// the normalizer's (`../document-normalizer.ts`).

import { z } from 'zod';

import { repairBox } from '../crop-box';
import { cleanText, DOCUMENT_MRZ_MAX_LENGTH, type RawDocumentScan } from '../document-normalizer';

/** A nullable string the model reads from the document. */
export const nullableString = (description: string) => z.string().nullable().describe(description);

/** A per-field confidence score. */
export const score = z.number().describe('0 (guess) to 1 (certain); 0 when the value is null.');

/** The document-locating box of one image slot. */
export const documentBoxSchema = (slot: string) =>
  z
    .object({
      x: z.number().describe('Left edge, fraction (0-1) of the image width.'),
      y: z.number().describe('Top edge, fraction (0-1) of the image height.'),
      width: z.number().describe('Box width, fraction (0-1) of the image width.'),
      height: z.number().describe('Box height, fraction (0-1) of the image height.'),
      quarter_turns: z
        .number()
        .describe('90-degree CLOCKWISE rotations (0-3) that make the cropped document read upright.'),
      confidence: z.number().describe('Confidence in the box, 0 to 1.'),
    })
    .nullable()
    .describe(
      `Tight bounding box around the document in the ${slot} image, as fractions of that image. ` +
        'Null when that image was not provided or shows no identity document.',
    );

/** The `mrz_lines` of the answer. */
export const mrzLinesSchema = z
  .array(z.string())
  .nullable()
  .describe(
    'The machine-readable zone lines, transcribed VERBATIM top to bottom, including every "<" filler. Null when the document has no machine-readable zone.',
  );

/** The model's warnings. */
export const warningsSchema = z
  .array(z.string())
  .describe(
    'Short notes about anything that made reading unreliable (glare, blur, cut-off edge, inferred kind, not an identity document). Never repeat a value read from the document.',
  );

/** The rules every document prompt shares (best guess, confidence scale, framing, boxes). */
export const COMMON_DOCUMENT_RULES = [
  'Your answer seeds an editable review form; a human verifies every value before anything is saved. So ALWAYS return your best reading of every field, even from poor images - a shaky value with honest low confidence and a warning is far more useful than null. Return null for a field only when you can see nothing for it at all.',
  'Confidence scale: 0.9-1.0 for crisp, unambiguous text; 0.5-0.8 for text that is readable but faint, glared, small, or partially obstructed; below 0.5 only when you are close to guessing. Set the confidence to 0 for every field you return as null.',
  'The document may occupy only part of the image, with background around it, and may be rotated or upside down. Locate it, mentally rotate and zoom in, and read it. Do not treat framing itself as a failure - only warn when characters are actually cut off at the image edge or truly unreadable.',
  'For each provided image, return its box as the tight bounding box around the document, with x, y, width and height as fractions of THAT image\'s width and height, and quarter_turns as the number of 90-degree clockwise rotations that make the cropped document read upright. Prefer a box slightly too large over one that cuts the document off. Return null for the box of an image that was not provided or shows no identity document.',
  'Never repeat a value read from the document inside `warnings`: name the field instead.',
  'If the images are not an identity document at all, return null for every field, 0 for every confidence, null for every box, and add a warning saying so.',
];

/** Trimmed, capped warnings (at most 20). */
export function cleanWarnings(warnings: readonly string[] | null | undefined): string[] {
  return (warnings ?? [])
    .map((w) => cleanText(w, 300))
    .filter((w): w is string => w !== null)
    .slice(0, 20);
}

/** Trimmed MRZ lines, or `null` when none is left. */
export function cleanMrzLines(lines: readonly string[] | null | undefined): string[] | null {
  const kept = (lines ?? [])
    .map((l) => cleanText(l, DOCUMENT_MRZ_MAX_LENGTH))
    .filter((l): l is string => l !== null)
    .slice(0, 3);
  return kept.length === 0 ? null : kept;
}

/** The repaired boxes of the answer, keyed by slot (`<slot>_box` in the answer). */
export function repairBoxes(
  output: Record<string, unknown>,
  slots: readonly string[],
): RawDocumentScan['boxes'] {
  const boxes: RawDocumentScan['boxes'] = {};
  for (const slot of slots) boxes[slot] = repairBox(output[`${slot}_box`] as Parameters<typeof repairBox>[0]);
  return boxes;
}
