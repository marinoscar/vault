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
        'The long card number (PAN). Digits only, no spaces. Null if not fully legible.',
    },
    exp_month: {
      ...nullableString,
      description: 'Expiry month as printed, e.g. "07" or "7".',
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
        'Whether the card is printed as Credit, Debit or Prepaid. Null if not printed on the card.',
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
 */
export const OPENAI_CARD_SYSTEM_PROMPT = [
  'You transcribe payment card photographs into structured data.',
  '',
  'Rules:',
  '1. NEVER output a CVV, CVC, CVC2, CVV2 or the 3-digit code printed on the signature panel. Do not output it in any field, and do not mention its digits in warnings. If you can see one, ignore it.',
  '2. `security_code_2` is NOT the CVV. It is only for a separate control / CID number printed flat on the card face, such as the 4-digit CID above the account number on an American Express card. If you are not certain a value is that separate control number, return null.',
  '3. Transcribe only what is clearly legible. If a value is blurred, glared, cropped, obscured or ambiguous, return null for it rather than guessing. A null is always better than a plausible invention.',
  '4. Never infer a value from another value. Do not derive the network from the first digit of the number, and do not invent an issuing bank from a logo you are unsure of.',
  '5. `card_network` and `card_kind` must be exactly one of the allowed enum values, or null. Do not invent new spellings.',
  '6. Set the matching `confidence` entry to 0 for every field you return as null.',
  '7. If the image is not a payment card at all, return null for every field, 0 for every confidence, and add a warning saying so.',
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
