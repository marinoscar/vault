/**
 * Display helpers for `format: 'country'` fields, over the contract's country
 * table (ISO 3166-1 alpha-3 plus the ICAO 9303 extras such as `UTO`).
 */

import { COUNTRY_TABLE, type CountryEntry } from '@marinoscar/vault-contract/common';

export type { CountryEntry };

const COUNTRY_BY_CODE = new Map<string, CountryEntry>(COUNTRY_TABLE.map((c) => [c.alpha3, c]));

/** The country row of an alpha-3 code (any case), or `null`. */
export function findCountry(code: unknown): CountryEntry | null {
  if (typeof code !== 'string') return null;
  return COUNTRY_BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** `"<name> (<alpha3>)"`, the label a country field shows. */
export function formatCountryLabel(country: Pick<CountryEntry, 'alpha3' | 'name'>): string {
  return `${country.name} (${country.alpha3})`;
}

/** The display text of a stored country code: `"Germany (DEU)"`, or the code itself when unknown. */
export function formatCountryValue(code: unknown): string {
  const country = findCountry(code);
  if (country) return formatCountryLabel(country);
  return typeof code === 'string' ? code : '';
}
