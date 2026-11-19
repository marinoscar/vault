// =============================================================================
// Country codes for document checks
// =============================================================================
//
// The table lives in @marinoscar/vault-contract (shared with the web app);
// this file re-exports it for the scan checks and adds the MRZ-only view.

import { isCountryCode } from '@marinoscar/vault-contract/common';

export {
  COUNTRY_CODES,
  COUNTRY_TABLE,
  isCountryCode,
  toAlpha3,
  type CountryEntry,
} from '@marinoscar/vault-contract/common';

/**
 * `true` for a code an MRZ may carry as issuing state or nationality: any
 * {@link isCountryCode} code plus the one-letter `D` (Germany). MRZ fillers
 * must be removed first.
 *
 * @stability experimental
 */
export function isMrzCountryCode(code: string): boolean {
  return code === 'D' || isCountryCode(code);
}
