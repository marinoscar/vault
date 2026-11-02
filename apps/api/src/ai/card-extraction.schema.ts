// =============================================================================
// Card extraction: the prompt, the model-facing schema and the repair step
// =============================================================================
// (issue #87, E8.1.) Was `providers/openai/openai-card-schema.ts`. The OpenAI
// JSON Schema is gone: `AiService.respondStructured` builds the provider's
// structured-output request from the Zod schema below, whichever provider and
// model the platform resolves. The prompt, the field set and the lenient repair
// stay Vault's.
//
// THE SECURITY CODE IS NOT PART OF THE ANSWER. The schema has no `cvv` or
// `security_code_2`, the prompt forbids reading one, and `normalizeExtractions`
// strips anything that still arrives under those names (or inside `notes`).
// =============================================================================

import { z } from 'zod';

import { CARD_KINDS, CARD_NETWORKS } from '../common/constants/card.constants';
import {
  CardCropBox,
  EXTRACTED_FIELD_NAMES,
  ExtractedFieldName,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
} from './card-extraction.types';

/** The schema name sent to the provider. */
export const CARD_EXTRACT_SCHEMA_NAME = 'card_extraction';

/** Fields the model is asked for (everything but the two security codes). */
export const MODEL_FIELD_NAMES = [
  'cardholder_name',
  'number',
  'exp_month',
  'exp_year',
  'card_network',
  'card_kind',
  'issuing_bank',
  'notes',
] as const satisfies readonly ExtractedFieldName[];

/**
 * System prompt.
 *
 * `card_kind` is the ONE field the model may CLASSIFY rather than transcribe (some
 * networks never print "Credit"); the inference is fenced with moderate confidence
 * and a mandatory warning. The overall policy is BEST GUESS, HUMAN DECIDES.
 */
export const CARD_EXTRACT_SYSTEM_PROMPT = [
  'You are an expert transcriber of payment card photographs into structured data. You read every card design: embossed plastic, flat-printed plastic, and metal cards with low-contrast laser-engraved text.',
  '',
  'Your answer seeds an editable review form; a human verifies every value before anything is saved. So ALWAYS return your best reading of every field, even from poor images - a shaky value with honest low confidence and a warning is far more useful than null. Return null for a field only when you can see nothing for it at all.',
  '',
  'Layout knowledge - use it to know where to look:',
  '- Many modern cards, especially premium and metal cards (for example the American Express Platinum) and many recent bank cards, print the card number, expiry date, and sometimes the cardholder name flat on the BACK. A front carrying only branding and a name is normal; look for the remaining values on the back image.',
  '- Metal cards engrave characters in faint grey-on-grey. Faint is not illegible: look closely and transcribe, expressing any doubt through the confidence score rather than by returning null.',
  '- American Express numbers are 15 digits grouped 4-6-5; most other networks use 16 digits grouped 4-4-4-4. The expiry usually follows "VALID THRU" or "THRU" as MM/YY.',
  '- If the card appears rotated, tilted, or upside down in the frame, mentally rotate it and transcribe anyway. Warn only if the rotation genuinely hides characters.',
  '- The card may occupy only part of the image, with background around it, and may be upside down. Locate it, mentally rotate and zoom in, and read it. Do not treat framing itself as a failure - only warn when characters are actually cut off at the image edge or truly unreadable.',
  '',
  'Rules:',
  '1. NEVER read, transcribe or return a card security code (CVV, CVC, CVV2, CVC2, CID, CSC, "Security Code", "Sec Code"), including the 3 or 4 digit group on the back or above the number on an American Express. It is not a field of the answer. If you notice one, ignore it entirely and do not mention its value anywhere, including `notes` and `warnings`.',
  '2. Do not confuse the short numeric groups on a card (the last four digits of the account number, the expiry, a "MEMBER SINCE" year): each belongs only to its own field.',
  '3. The card number, expiry and cardholder name must be READ from the images - best-effort. Transcribe what you see as completely as you can; when characters are uncertain, give your best interpretation, lower the confidence, and add a warning naming which part was uncertain. Never fabricate a value for which nothing is visible at all.',
  '4. `card_network`: identify from the brand mark or wordmark anywhere on either side.',
  '5. `card_kind`: if the card prints Credit, Debit or Prepaid, use that with high confidence. If it does not, you MAY classify it from unambiguous product knowledge - for example, American Express charge and credit products (Green, Gold, Platinum, Centurion) are "Credit"; classify charge cards as "Credit". Give an inferred card_kind moderate confidence (around 0.6) and add a short warning saying the card type was inferred from the product, not read. If genuinely unsure, return null.',
  '6. `issuing_bank`: the institution named on the card. Networks that issue their own cards (American Express, Discover) are also the issuer - use the network name in that case.',
  '7. `notes`: gather any other useful printed text - customer service phone numbers, a "Member Since" year, a website, a contactless indicator, usage instructions - into `notes`, one item per line. NEVER put the card number or any security code there. Return null when there is nothing beyond the other fields.',
  '8. `card_network` and `card_kind` must be exactly one of the allowed enum values, or null. Do not invent new spellings.',
  '9. Confidence scale: 0.9-1.0 for crisp, unambiguous text; 0.5-0.8 for text that is readable but faint, glared, small, or partially obstructed; below 0.5 only when you are close to guessing. Set the confidence to 0 for every field you return as null.',
  '10. For each provided image, return `front_box`/`back_box` as the tight bounding box around the payment card, with x, y, width and height as fractions of THAT image\'s width and height, and quarter_turns as the number of 90-degree clockwise rotations that make the cropped card read upright. The box is used to crop the stored copy of the photo, so prefer a box slightly too large over one that cuts the card off. Return null for the box of an image that was not provided or in which no card is visible.',
  '11. If the images are not a payment card at all, return null for every field, 0 for every confidence, null for both boxes, and add a warning saying so.',
].join('\n');

// -----------------------------------------------------------------------------
// Model-facing schema
// -----------------------------------------------------------------------------

const nullableString = (description: string) => z.string().nullable().describe(description);
const score = z.number().describe('0 (guess) to 1 (certain); 0 when the value is null.');

/**
 * The card_network / card_kind enums are built from the SAME constants the
 * `Card` secret type is seeded from (`common/constants/card.constants.ts`):
 * the extract response feeds a form that is POSTed to /api/secrets, which
 * rejects any select value outside the seeded options.
 */
const boxSchema = (side: 'front' | 'back') =>
  z
    .object({
      x: z.number().describe('Left edge, fraction (0-1) of the image width.'),
      y: z.number().describe('Top edge, fraction (0-1) of the image height.'),
      width: z.number().describe('Box width, fraction (0-1) of the image width.'),
      height: z.number().describe('Box height, fraction (0-1) of the image height.'),
      quarter_turns: z
        .number()
        .describe('90-degree CLOCKWISE rotations (0-3) that make the cropped card read upright.'),
      confidence: z.number().describe('Confidence in the box, 0 to 1.'),
    })
    .nullable()
    .describe(
      `Tight bounding box around the payment card in the ${side} image, as fractions of that image. ` +
        'x=0, y=0, width=1, height=1 when the card fills the image. Null when that image was not provided or shows no card.',
    );

export const cardExtractionModelSchema = z.object({
  cardholder_name: nullableString('Name embossed or printed on the card, exactly as shown.'),
  number: nullableString(
    'The long card number (PAN). Digits only, no spaces. On many modern cards it is printed on the BACK. 15 digits for American Express, usually 16 for other networks. Best-effort reading with an honest confidence; null only when no digits are visible at all.',
  ),
  exp_month: nullableString('Expiry month as printed, e.g. "07" or "7". Often follows "VALID THRU".'),
  exp_year: nullableString('Expiry year as printed, e.g. "27" or "2027".'),
  card_network: z
    .enum(CARD_NETWORKS as unknown as [string, ...string[]])
    .nullable()
    .describe('Payment network shown by the card brand mark. Null if no brand mark is legible.'),
  card_kind: z
    .enum(CARD_KINDS as unknown as [string, ...string[]])
    .nullable()
    .describe(
      'Credit, Debit or Prepaid - as printed, or classified from unambiguous product knowledge (see the rules). Null if unsure.',
    ),
  issuing_bank: nullableString('Issuing bank or institution name printed on the card.'),
  notes: nullableString(
    'Other useful, non-sensitive text printed on the card: customer service phone numbers, "Member Since" year, website, contactless indicator. One item per line. NEVER the card number or any security code. Null if there is nothing.',
  ),
  confidence: z.object({
    cardholder_name: score,
    number: score,
    exp_month: score,
    exp_year: score,
    card_network: score,
    card_kind: score,
    issuing_bank: score,
    notes: score,
  }),
  warnings: z
    .array(z.string())
    .describe('Short notes about anything that made reading the card unreliable (glare, blur, cropped edge, not a payment card).'),
  front_box: boxSchema('front'),
  back_box: boxSchema('back'),
});

export type CardExtractionModelOutput = z.infer<typeof cardExtractionModelSchema>;

// -----------------------------------------------------------------------------
// Repair: model output to RawExtraction
// -----------------------------------------------------------------------------

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Trim; empty becomes null; long values are truncated rather than rejected. */
function cleanString(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/**
 * A card-locating box, repaired: coordinates clamped into [0,1], width/height
 * into [0.05,1], quarter turns wrapped into 0-3. Not-a-number degrades the
 * field to a harmless default. A bad box never costs the user their field data.
 */
function repairBox(
  box: CardExtractionModelOutput['front_box'],
): CardCropBox | null {
  if (!box) return null;
  return {
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: Number.isFinite(box.width) ? Math.min(1, Math.max(0.05, box.width)) : 1,
    height: Number.isFinite(box.height) ? Math.min(1, Math.max(0.05, box.height)) : 1,
    quarterTurns: Number.isFinite(box.quarter_turns)
      ? ((Math.round(box.quarter_turns) % 4) + 4) % 4
      : 0,
    confidence: clamp01(box.confidence),
  };
}

/**
 * Turns the validated model answer into a {@link RawExtraction}: strings cleaned
 * and bounded, confidences clamped, boxes repaired. The two security-code fields
 * are always null (they are not asked for; see the file header).
 */
export function toRawExtraction(output: CardExtractionModelOutput, model: string): RawExtraction {
  const fields = {} as RawCardFields;
  const confidence = {} as RawCardConfidence;
  for (const name of EXTRACTED_FIELD_NAMES) {
    fields[name] = null;
    confidence[name] = 0;
  }
  for (const name of MODEL_FIELD_NAMES) {
    fields[name] = cleanString(output[name], name === 'notes' ? 1000 : 200);
    confidence[name] = clamp01(output.confidence[name]);
  }
  return {
    fields,
    confidence,
    warnings: output.warnings
      .map((w) => w.trim().slice(0, 300))
      .filter((w) => w.length > 0)
      .slice(0, 20),
    model,
    frontBox: repairBox(output.front_box),
    backBox: repairBox(output.back_box),
  };
}
