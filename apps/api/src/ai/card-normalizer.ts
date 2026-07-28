// =============================================================================
// Card Extraction Normalization
// =============================================================================
// Pure functions - no I/O, no Nest. Everything here happens server-side so the
// values handed back are already in the exact shape /api/secrets will accept
// for the seeded `Card` secret type.

import {
  CARD_KINDS,
  CARD_NETWORKS,
} from '../common/constants/card.constants';
import {
  CardCropBox,
  EXTRACTED_FIELD_NAMES,
  ExtractedFieldName,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
} from './providers/vision-provider.interface';

export interface NormalizedExtraction {
  fields: RawCardFields;
  confidence: RawCardConfidence;
  warnings: string[];
  /**
   * Where the model located the card in each supplied image. Not merged like
   * the fields - a box only makes sense against the one image it was drawn
   * on, so each comes from the first source that saw that image. Null when
   * the image was absent or contained no visible card.
   */
  crops: { front: CardCropBox | null; back: CardCropBox | null };
  /**
   * True when the model answered but every field came back null. About the
   * FIELD data only - the crop boxes play no part in it.
   */
  partial: boolean;
}

// -----------------------------------------------------------------------------
// Merge
// -----------------------------------------------------------------------------

/**
 * Merge per-side extractions field by field, keeping the value from whichever
 * side was more confident about that specific field.
 *
 * A card is not read once - the number and expiry are on one side, the issuing
 * bank and control number are often on the other, and both sides frequently
 * carry a partial view of the same field. Taking "front wins" wholesale would
 * throw away a crisp reading from the back; taking the last non-null would make
 * the result depend on argument order.
 *
 * Null values never win, regardless of the score attached to them.
 */
export function mergeExtractions(
  sources: RawExtraction[],
): { fields: RawCardFields; confidence: RawCardConfidence; warnings: string[] } {
  const fields = {} as RawCardFields;
  const confidence = {} as RawCardConfidence;

  for (const name of EXTRACTED_FIELD_NAMES) {
    let bestValue: string | null = null;
    let bestScore = 0;

    for (const source of sources) {
      const value = source.fields[name];
      if (value === null) continue;

      const score = source.confidence[name] ?? 0;
      if (bestValue === null || score > bestScore) {
        bestValue = value;
        bestScore = score;
      }
    }

    fields[name] = bestValue;
    confidence[name] = bestValue === null ? 0 : bestScore;
  }

  return {
    fields,
    confidence,
    warnings: dedupe(sources.flatMap((source) => source.warnings)),
  };
}

// -----------------------------------------------------------------------------
// Field normalization
// -----------------------------------------------------------------------------

/** Card number reduced to digits. Spaces, dashes and unicode look-alikes go. */
export function normalizeCardNumber(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}

/**
 * Expiry month as zero-padded MM.
 *
 * Tolerates a model that returned the whole "07/27" stamp in the month field,
 * which happens often enough to be worth handling.
 */
export function normalizeExpMonth(value: string | null): string | null {
  if (value === null) return null;
  const match = value.match(/\d{1,2}/);
  if (!match) return null;
  const month = Number.parseInt(match[0], 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return String(month).padStart(2, '0');
}

/**
 * Expiry year as four digits.
 *
 * A two-digit year is expanded into the 2000s. Cards are not issued with
 * 19xx expiries and will not outlive 2099, so a fixed century beats any
 * sliding-window cleverness.
 */
export function normalizeExpYear(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 2) return `20${digits}`;
  if (digits.length === 4) {
    const year = Number.parseInt(digits, 10);
    return year >= 2000 && year <= 2099 ? digits : null;
  }
  return null;
}

/**
 * Card security code reduced to digits, accepted only at a real length.
 *
 * A security code is 3 digits on most networks and 4 on American Express, so
 * anything else came from the model reading the wrong thing - the last group of
 * the account number, a "MEMBER SINCE" year, an expiry - and a wrong code is
 * worse than an empty box: it looks authoritative on the review screen and only
 * fails at a payment terminal months later. Rejecting the odd lengths sends the
 * user to the one place the value can be checked in a second, the card itself.
 */
export function normalizeSecurityCode(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 3 || digits.length === 4 ? digits : null;
}

/**
 * Match a model answer against the shared constants, case-insensitively.
 *
 * Returns `Other` for anything unrecognised rather than null, because `Other`
 * is itself a seeded option: a card whose brand mark we could not classify is
 * still a card, and the user can correct a wrong dropdown far more easily than
 * they can notice an empty one.
 */
export function matchOption(
  value: string | null,
  options: readonly string[],
): { value: string | null; unrecognised: boolean } {
  if (value === null) return { value: null, unrecognised: false };

  const needle = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const match = options.find(
    (option) => option.toLowerCase() === needle,
  );

  if (match) return { value: match, unrecognised: false };
  return { value: 'Other', unrecognised: true };
}

/**
 * Luhn checksum.
 *
 * The result is only ever a WARNING. A failing checksum is far more likely to
 * mean one digit was misread off a glossy card than that the card is fake, and
 * refusing the whole extraction would send the user back to manual entry for
 * the sake of a single character they can see and fix on the review screen.
 */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 12) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------

/**
 * Merge every side, then normalize the merged result.
 *
 * Normalizing after the merge (rather than per side) keeps the warnings honest:
 * every warning emitted here describes a value that is actually in the
 * response, instead of one that lost the merge and was discarded.
 */
export function normalizeExtractions(
  sources: RawExtraction[],
): NormalizedExtraction {
  const merged = mergeExtractions(sources);
  const fields = { ...merged.fields };
  const confidence = { ...merged.confidence };
  const warnings = [...merged.warnings];

  const clearField = (name: ExtractedFieldName) => {
    fields[name] = null;
    confidence[name] = 0;
  };

  // Card number -> digits only, then checksum.
  fields.number = normalizeCardNumber(fields.number);
  if (fields.number === null) {
    confidence.number = 0;
  } else if (!passesLuhn(fields.number)) {
    warnings.push(
      'The card number did not pass its checksum, so at least one digit was probably misread. Please check it against the card.',
    );
  }

  // Expiry.
  const rawMonth = fields.exp_month;
  fields.exp_month = normalizeExpMonth(rawMonth);
  if (rawMonth !== null && fields.exp_month === null) {
    warnings.push('The expiry month could not be read reliably.');
    confidence.exp_month = 0;
  }

  const rawYear = fields.exp_year;
  fields.exp_year = normalizeExpYear(rawYear);
  if (rawYear !== null && fields.exp_year === null) {
    warnings.push('The expiry year could not be read reliably.');
    confidence.exp_year = 0;
  }

  // Security codes: digits only, and only at a length a real code can have.
  const rawCvv = fields.cvv;
  fields.cvv = normalizeSecurityCode(rawCvv);
  if (rawCvv !== null && fields.cvv === null) {
    warnings.push(
      'The security code could not be read reliably — type it from the card.',
    );
    confidence.cvv = 0;
  }

  const rawSecondCode = fields.security_code_2;
  fields.security_code_2 = normalizeSecurityCode(rawSecondCode);
  if (rawSecondCode !== null && fields.security_code_2 === null) {
    confidence.security_code_2 = 0;
  }

  // A model that finds one code and reports it twice would otherwise leave the
  // user with a phantom "second code" to reconcile against a card that has one.
  if (fields.cvv !== null && fields.security_code_2 === fields.cvv) {
    fields.security_code_2 = null;
    confidence.security_code_2 = 0;
  }

  // Select fields must land on a seeded option or /api/secrets will 400 on save.
  const network = matchOption(fields.card_network, CARD_NETWORKS);
  fields.card_network = network.value;
  if (network.unrecognised) {
    warnings.push(
      'The card network was not recognised and has been set to "Other". Please pick the right one.',
    );
  }

  const kind = matchOption(fields.card_kind, CARD_KINDS);
  fields.card_kind = kind.value;
  if (kind.unrecognised) {
    warnings.push(
      'The card type was not recognised and has been set to "Other". Please pick the right one.',
    );
  }

  // Defensive: a value that normalized away must not keep a confidence score.
  for (const name of EXTRACTED_FIELD_NAMES) {
    if (fields[name] === null && confidence[name] !== 0) clearField(name);
  }

  const partial = EXTRACTED_FIELD_NAMES.every((name) => fields[name] === null);
  if (partial) {
    warnings.push(
      'Nothing could be read from these images. Try a sharper, better-lit photo, or enter the details manually.',
    );
  }

  // Boxes are image-scoped, not card-scoped, so they bypass the confidence
  // merge entirely: the first source's reading of each image wins. The caller
  // (CardExtractService) knows how many images were actually sent and forces
  // `back` to null when there was no back image.
  const crops = {
    front: sources[0]?.frontBox ?? null,
    back: sources[0]?.backBox ?? null,
  };

  return { fields, confidence, warnings: dedupe(warnings), crops, partial };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
