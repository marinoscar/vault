// =============================================================================
// OpenAI Structured Output Schema for Card Extraction
// =============================================================================

import { z } from 'zod';
import {
  CARD_NETWORKS,
  CARD_KINDS,
} from '../../../common/constants/card.constants';
import {
  CardCropBox,
  EXTRACTED_FIELD_NAMES,
} from '../vision-provider.interface';

export const OPENAI_CARD_SCHEMA_NAME = 'card_extraction';

/**
 * A nullable string under OpenAI structured outputs.
 *
 * With `strict: true` every property must appear in `required`, so "optional"
 * is expressed as a `['string','null']` type union rather than by omission.
 */
const nullableString = { type: ['string', 'null'] };

/**
 * The card_network / card_kind enums are built from the SAME constants the
 * `Card` secret type is seeded from (src/common/constants/card.constants.ts).
 *
 * This is load-bearing: the extract response feeds a form that is ultimately
 * POSTed to /api/secrets, where `validateDataAgainstType` rejects any select
 * value outside the seeded `options`. If the model were free to answer
 * "MasterCard" while the seed stored "Mastercard", the user would photograph
 * the card, review the result, confirm, and only then eat a 400 on save.
 */
const nullableEnum = (values: readonly string[]) => ({
  type: ['string', 'null'],
  enum: [...values, null],
});

/**
 * A card-locating bounding box under OpenAI structured outputs.
 *
 * Nullable at the top (`['object','null']`) because with `strict: true` the
 * property must always appear; null expresses "that image was not provided or
 * no card is visible in it". All coordinates are FRACTIONS of the image as
 * sent, so the client can crop without knowing the pixel dimensions we saw.
 */
const cropBoxJsonSchema = (side: 'front' | 'back') => ({
  type: ['object', 'null'],
  description:
    `Tight bounding box around the payment card in the ${side} image, as ` +
    `fractions of that image's width and height. Use x=0, y=0, width=1, ` +
    `height=1 when the card fills the image. Null when that image was not ` +
    `provided or no card is visible in it.`,
  additionalProperties: false,
  required: ['x', 'y', 'width', 'height', 'quarter_turns', 'confidence'],
  properties: {
    x: {
      type: 'number',
      description: 'Left edge of the box, as a fraction (0-1) of the image width.',
    },
    y: {
      type: 'number',
      description: 'Top edge of the box, as a fraction (0-1) of the image height.',
    },
    width: {
      type: 'number',
      description: 'Box width, as a fraction (0-1) of the image width.',
    },
    height: {
      type: 'number',
      description: 'Box height, as a fraction (0-1) of the image height.',
    },
    quarter_turns: {
      type: 'integer',
      description:
        'Number of 90-degree CLOCKWISE rotations (0-3) to apply to the cropped rectangle so the card reads upright.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence in the box placement, 0 (guess) to 1 (certain).',
    },
  },
});

const confidenceProperties = Object.fromEntries(
  EXTRACTED_FIELD_NAMES.map((name) => [
    name,
    {
      type: 'number',
      description:
        'Confidence in the value for this field, 0 (guess) to 1 (certain). Use 0 when the value is null.',
    },
  ]),
);

/**
 * JSON Schema sent as `response_format.json_schema.schema`.
 *
 * `strict: true` requires `additionalProperties: false` and a complete
 * `required` list at EVERY object level - including the nested `confidence`
 * object - or OpenAI rejects the request with a 400 before any inference runs.
 */
export const OPENAI_CARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...EXTRACTED_FIELD_NAMES,
    'confidence',
    'warnings',
    'front_box',
    'back_box',
  ],
  properties: {
    cardholder_name: {
      ...nullableString,
      description: 'Name embossed or printed on the card, exactly as shown.',
    },
    number: {
      ...nullableString,
      description:
        'The long card number (PAN). Digits only, no spaces. On many modern cards it is printed on the BACK. 15 digits for American Express, usually 16 for other networks. Give your best-effort reading of the digits with an honest confidence score; null only when no digits are visible at all.',
    },
    exp_month: {
      ...nullableString,
      description: 'Expiry month as printed, e.g. "07" or "7". Often follows "VALID THRU".',
    },
    exp_year: {
      ...nullableString,
      description: 'Expiry year as printed, e.g. "27" or "2027".',
    },
    cvv: {
      ...nullableString,
      description:
        'The card security code used for online purchases (CVV / CVC / CVV2 / CVC2 / CID / CSC / "Sec Code" / "Security Code"). Digits only, 3 or 4 of them. For Visa, Mastercard, Discover and most networks this is the 3-digit group on the BACK, beside or on the signature panel; for American Express it is the 4-digit group printed on the FRONT, above the account number. It is very often printed with no label at all.',
    },
    card_network: {
      ...nullableEnum(CARD_NETWORKS),
      description:
        'Payment network shown by the card brand mark. Null if no brand mark is legible.',
    },
    card_kind: {
      ...nullableEnum(CARD_KINDS),
      description:
        'Credit, Debit or Prepaid - as printed on the card, or classified from unambiguous product knowledge when not printed (see the rules). Null if unsure.',
    },
    issuing_bank: {
      ...nullableString,
      description: 'Issuing bank or institution name printed on the card.',
    },
    security_code_2: {
      ...nullableString,
      description:
        'An ADDITIONAL security or control number, only for cards that print more than one - for example an American Express whose primary 4-digit CID is on the front and which carries a second code on the back. Never a copy of the value already returned in `cvv`. Null when the card carries only one code, which is the usual case.',
    },
    notes: {
      ...nullableString,
      description:
        'Other useful, non-sensitive text printed on the card: customer service phone numbers, "Member Since" year, website, contactless indicator, usage instructions. One item per line. NEVER include the card number, CVV, or any security code here. Null if there is nothing beyond the other fields.',
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: [...EXTRACTED_FIELD_NAMES],
      properties: confidenceProperties,
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short, human-readable notes about anything that made reading the card unreliable (glare, blur, cropped edge, not a payment card).',
    },
    front_box: cropBoxJsonSchema('front'),
    back_box: cropBoxJsonSchema('back'),
  },
} as const;

/**
 * System prompt.
 *
 * The security code gets two rules rather than one - where to find it, then
 * what it is NOT - because in practice the failure mode is never a model that
 * refuses to look: it is a model that returns the last four digits of the PAN,
 * a "MEMBER SINCE" year, or the expiry, all of which are short digit groups
 * sitting millimetres away. The positions and the labels are both spelled out
 * because real cards caption this value at least eight different ways and very
 * often not at all.
 *
 * `card_kind` is the ONE field the model is allowed to CLASSIFY rather than
 * transcribe, because networks like American Express never print "Credit"
 * anywhere on the card, so a transcription-only rule would return null for
 * every card of theirs. The inference is fenced: an inferred kind carries
 * moderate confidence and a mandatory warning, so the review screen presents
 * it as a suggestion, not a reading.
 *
 * The overall policy is BEST GUESS, HUMAN DECIDES: every answer lands on an
 * editable review form, so an uncertain reading with honest low confidence
 * always beats a null. No field is exempt from that policy.
 */
export const OPENAI_CARD_SYSTEM_PROMPT = [
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
  '1. `cvv` is the card security code used for online purchases, and reading it is part of the job. Where to look: for Visa, Mastercard, Discover and most networks it is the 3-digit group on the BACK, printed on or beside the signature panel; on an American Express it is the 4-digit group on the FRONT, above and to the right of the account number. Its caption varies - CVV, CVC, CVV2, CVC2, CID, CSC, "Sec Code", "Security Code" - and is very often absent entirely: a short standalone group of 3 or 4 digits in one of those positions IS the security code even when nothing labels it, so do not skip it for want of a caption. Return digits only, never the caption text.',
  '2. Do not confuse `cvv` with anything else short and numeric on the card: the last four digits of the account number, the expiry, and a "MEMBER SINCE" year all sit in their own printed positions and appear elsewhere on the card. `security_code_2` is only for a SECOND security code on a card that prints more than one (an American Express with its CID on the front may carry another code on the back); return null for it whenever the card has just one code, and never repeat the `cvv` value there.',
  '3. The card number, expiry, cardholder name, cvv and security_code_2 must be READ from the images - best-effort. Transcribe what you see as completely as you can; when characters are uncertain, give your best interpretation, lower the confidence, and add a warning naming which part was uncertain. Never fabricate a value for which nothing is visible at all.',
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
// Wire re-validation
// -----------------------------------------------------------------------------

/**
 * A field value: must be present and must be a string or null. A missing key or
 * a non-string type is a genuine protocol violation and is allowed to fail.
 * Over-long values are truncated rather than rejected - discarding an otherwise
 * good scan because one field came back verbose helps nobody.
 */
const nullableStringField = z
  .union([z.string(), z.null()])
  .transform((v) => {
    const trimmed = (v ?? '').trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, 200);
  });

/**
 * Same contract as `nullableStringField`, but sized for `notes`: a multi-line
 * collection of auxiliary text (phone numbers, "Member Since", instructions)
 * legitimately outgrows the 200 characters that fence a single card field, so
 * the truncation point moves to 1000 rather than silently amputating real
 * information off the card.
 */
const nullableLongStringField = z
  .union([z.string(), z.null()])
  .transform((v) => {
    const trimmed = (v ?? '').trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, 1000);
  });

/**
 * A confidence score. Tolerant on purpose: a missing or nonsensical score
 * degrades to 0, which only costs that field the front/back merge tie-break.
 */
const confidenceValue = z
  .number()
  .catch(0)
  .transform((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));

const clamp01 = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/**
 * A card-locating box, re-validated and repaired.
 *
 * Deliberately forgiving in a different way from the field values: a
 * malformed box degrades to null via `.catch(null)` rather than failing the
 * parse, because a bad box must not cost the user their field data - the
 * fields are the product, the box only saves a manual crop. Coordinates are
 * clamped into [0,1]; width/height into (0,1] with a 0.05 floor so a
 * degenerate sliver cannot produce an unusable crop; quarter_turns is rounded
 * and wrapped into 0-3 (negatives included, so -1 becomes 3).
 */
const cropBoxSchema: z.ZodType<CardCropBox | null, z.ZodTypeDef, unknown> = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    quarter_turns: z.number(),
    confidence: z.number(),
  })
  .transform(
    (box): CardCropBox => ({
      x: clamp01(box.x),
      y: clamp01(box.y),
      width: Number.isFinite(box.width)
        ? Math.min(1, Math.max(0.05, box.width))
        : 1,
      height: Number.isFinite(box.height)
        ? Math.min(1, Math.max(0.05, box.height))
        : 1,
      quarterTurns: Number.isFinite(box.quarter_turns)
        ? ((Math.round(box.quarter_turns) % 4) + 4) % 4
        : 0,
      confidence: clamp01(box.confidence),
    }),
  )
  .nullable()
  .catch(null);

/**
 * Zod re-validation of the model's JSON.
 *
 * `strict: true` structured outputs are enforced by OpenAI, not by us. This is
 * still the wire: a proxy, a model regression, a future provider swap, or a
 * simple API change can all produce something the schema promised was
 * impossible. Nothing downstream is allowed to trust the raw payload.
 *
 * Note the deliberate asymmetry: a missing or wrongly-typed FIELD fails and
 * surfaces as 422 AI_EXTRACTION_FAILED, while a missing or nonsensical
 * CONFIDENCE degrades to 0. A broken payload should be reported; a slightly
 * sloppy score should not throw away a good scan.
 */
export const openAiCardResponseSchema = z.object({
  cardholder_name: nullableStringField,
  number: nullableStringField,
  exp_month: nullableStringField,
  exp_year: nullableStringField,
  cvv: nullableStringField,
  card_network: nullableStringField,
  card_kind: nullableStringField,
  issuing_bank: nullableStringField,
  security_code_2: nullableStringField,
  notes: nullableLongStringField,
  confidence: z.object({
    cardholder_name: confidenceValue,
    number: confidenceValue,
    exp_month: confidenceValue,
    exp_year: confidenceValue,
    cvv: confidenceValue,
    card_network: confidenceValue,
    card_kind: confidenceValue,
    issuing_bank: confidenceValue,
    security_code_2: confidenceValue,
    notes: confidenceValue,
  }),
  warnings: z
    .array(z.string().trim().max(300))
    .max(20)
    .catch([])
    .transform((list) => list.filter((w) => w.length > 0)),
  front_box: cropBoxSchema,
  back_box: cropBoxSchema,
});

export type OpenAiCardResponse = z.infer<typeof openAiCardResponseSchema>;
