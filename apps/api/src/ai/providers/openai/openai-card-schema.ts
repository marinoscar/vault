// =============================================================================
// OpenAI Structured Output Schema for Card Extraction
// =============================================================================

import { z } from 'zod';
import {
  CARD_NETWORKS,
  CARD_KINDS,
} from '../../../common/constants/card.constants';
import { EXTRACTED_FIELD_NAMES } from '../vision-provider.interface';

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
  required: [...EXTRACTED_FIELD_NAMES, 'confidence', 'warnings'],
  properties: {
    cardholder_name: {
      ...nullableString,
      description: 'Name embossed or printed on the card, exactly as shown.',
    },
    number: {
      ...nullableString,
      description:
        'The long card number (PAN). Digits only, no spaces. On many modern cards it is printed on the BACK. 15 digits for American Express, usually 16 for other networks. Null only if not fully legible.',
    },
    exp_month: {
      ...nullableString,
      description: 'Expiry month as printed, e.g. "07" or "7". Often follows "VALID THRU".',
    },
    exp_year: {
      ...nullableString,
      description: 'Expiry year as printed, e.g. "27" or "2027".',
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
        'ONLY a secondary control / CID number printed flat on the card face (for example the 4-digit CID on the front of an American Express card). This is NOT the CVV/CVC. Null unless such a separate control number is clearly present.',
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
  },
} as const;

/**
 * System prompt.
 *
 * The CVV prohibition is stated twice on purpose - once as a rule and once as
 * an anti-confusion note next to `security_code_2` - because the two values sit
 * millimetres apart on a real card and the schema alone cannot prevent the
 * model from putting the CVV in the wrong slot.
 *
 * `card_kind` is the ONE field the model is allowed to CLASSIFY rather than
 * transcribe, because networks like American Express never print "Credit"
 * anywhere on the card, so a transcription-only rule would return null for
 * every card of theirs. The inference is fenced: its confidence is capped and
 * a warning is mandatory, so the review screen presents it as a suggestion,
 * not a reading.
 */
export const OPENAI_CARD_SYSTEM_PROMPT = [
  'You are an expert transcriber of payment card photographs into structured data. You read every card design: embossed plastic, flat-printed plastic, and metal cards with low-contrast laser-engraved text.',
  '',
  'Layout knowledge - use it to know where to look:',
  '- Many modern cards, especially premium and metal cards (for example the American Express Platinum) and many recent bank cards, print the card number, expiry date, and sometimes the cardholder name flat on the BACK. A front carrying only branding and a name is normal; look for the remaining values on the back image.',
  '- Metal cards engrave characters in faint grey-on-grey. Faint is not illegible: look closely and transcribe, expressing any doubt through the confidence score rather than by returning null.',
  '- American Express numbers are 15 digits grouped 4-6-5; most other networks use 16 digits grouped 4-4-4-4. The expiry usually follows "VALID THRU" or "THRU" as MM/YY.',
  '- If the card appears rotated, tilted, or upside down in the frame, mentally rotate it and transcribe anyway. Warn only if the rotation genuinely hides characters.',
  '',
  'Rules:',
  '1. NEVER output a CVV, CVC, CVC2, CVV2 or the 3-digit code printed on the signature panel. Do not output it in any field, and do not mention its digits in warnings. If you can see one, ignore it.',
  '2. `security_code_2` is NOT the CVV. It is only for a separate control / CID number printed flat on the card face, such as the 4-digit CID above the account number on an American Express card. If you are not certain a value is that separate control number, return null.',
  '3. The card number, expiry, cardholder name and security_code_2 must be READ from the images, character by character. Never derive, complete, or invent them. If part of one is truly illegible after a careful look, return null for that field - but do not give up on text merely because it is faint, small, or low-contrast.',
  '4. `card_network`: identify from the brand mark or wordmark anywhere on either side.',
  '5. `card_kind`: if the card prints Credit, Debit or Prepaid, use that. If it does not, you MAY classify it from unambiguous product knowledge - for example, American Express charge and credit products (Green, Gold, Platinum, Centurion) are "Credit"; classify charge cards as "Credit". Cap the confidence of any card_kind that is not literally printed on the card at 0.6, and add a short warning saying the card type was inferred from the product, not read. If genuinely unsure, return null.',
  '6. `issuing_bank`: the institution named on the card. Networks that issue their own cards (American Express, Discover) are also the issuer - use the network name in that case.',
  '7. `card_network` and `card_kind` must be exactly one of the allowed enum values, or null. Do not invent new spellings.',
  '8. Confidence scale: 0.9-1.0 for crisp, unambiguous text; 0.5-0.8 for text that is readable but faint, glared, small, or partially obstructed; below 0.5 only when you are close to guessing. Set the confidence to 0 for every field you return as null.',
  '9. If the images are not a payment card at all, return null for every field, 0 for every confidence, and add a warning saying so.',
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
 * A confidence score. Tolerant on purpose: a missing or nonsensical score
 * degrades to 0, which only costs that field the front/back merge tie-break.
 */
const confidenceValue = z
  .number()
  .catch(0)
  .transform((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));

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
  card_network: nullableStringField,
  card_kind: nullableStringField,
  issuing_bank: nullableStringField,
  security_code_2: nullableStringField,
  confidence: z.object({
    cardholder_name: confidenceValue,
    number: confidenceValue,
    exp_month: confidenceValue,
    exp_year: confidenceValue,
    card_network: confidenceValue,
    card_kind: confidenceValue,
    issuing_bank: confidenceValue,
    security_code_2: confidenceValue,
  }),
  warnings: z
    .array(z.string().trim().max(300))
    .max(20)
    .catch([])
    .transform((list) => list.filter((w) => w.length > 0)),
});

export type OpenAiCardResponse = z.infer<typeof openAiCardResponseSchema>;
