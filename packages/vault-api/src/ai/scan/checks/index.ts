// Document check library for AI document scanning (IDOC-2). Pure functions.

export { AAMVA_JURISDICTIONS, jurisdictionAgrees } from './aamva';
export {
  COUNTRY_CODES,
  COUNTRY_TABLE,
  isCountryCode,
  isMrzCountryCode,
  toAlpha3,
  type CountryEntry,
} from './country';
export { mrzDate, normalizeDate } from './dates';
export {
  mrzCheckDigit,
  parseMrz,
  type MrzCheckField,
  type MrzFormat,
  type MrzParseOptions,
  type MrzParseResult,
} from './mrz';
export { checkSsn, type SsnCheckReason, type SsnCheckResult } from './ssn';
export { checkVin, vinCheckDigit, type VinCheckReason, type VinCheckResult } from './vin';

/**
 * The checks a document kind can declare (referenced by the scan kind
 * catalog).
 *
 * @stability experimental
 */
export type CheckId = 'mrz' | 'ssn' | 'vin' | 'aamva';
