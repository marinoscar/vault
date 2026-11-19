import { describe, expect, it } from 'vitest';

import { COUNTRY_CODES, COUNTRY_TABLE, isCountryCode, toAlpha3 } from '../src/common/index.js';

describe('country table', () => {
  it('has unique alpha-3 and alpha-2 codes', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    const alpha2 = COUNTRY_TABLE.flatMap((c) => (c.alpha2 ? [c.alpha2] : []));
    expect(new Set(alpha2).size).toBe(alpha2.length);
    expect(COUNTRY_TABLE.length).toBeGreaterThanOrEqual(249 + 13);
    for (const c of COUNTRY_TABLE) {
      expect(c.alpha3).toMatch(/^[A-Z]{3}$/);
      if (c.alpha2 !== null) expect(c.alpha2).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('includes the ICAO extras and the UTO specimen state', () => {
    for (const code of [
      'GBD',
      'GBN',
      'GBO',
      'GBP',
      'GBS',
      'UNO',
      'UNA',
      'UNK',
      'XXA',
      'XXB',
      'XXC',
      'XXX',
      'UTO',
    ]) {
      expect(isCountryCode(code)).toBe(true);
    }
  });

  it('checks upper-case alpha-3 codes only', () => {
    expect(isCountryCode('DEU')).toBe(true);
    expect(isCountryCode('deu')).toBe(false);
    expect(isCountryCode('DE')).toBe(false);
    expect(isCountryCode('ZZZ')).toBe(false);
  });

  it('resolves alpha-2, alpha-3, names and the MRZ D', () => {
    expect(toAlpha3('de')).toBe('DEU');
    expect(toAlpha3(' fra ')).toBe('FRA');
    expect(toAlpha3('United States')).toBe('USA');
    expect(toAlpha3('united  kingdom')).toBe('GBR');
    expect(toAlpha3('Great Britain')).toBe('GBR');
    expect(toAlpha3('D')).toBe('DEU');
    expect(toAlpha3('D<<')).toBe('DEU');
    expect(toAlpha3('uto')).toBe('UTO');
    expect(toAlpha3('Atlantis')).toBeNull();
    expect(toAlpha3('ZZ')).toBeNull();
    for (const c of COUNTRY_TABLE) {
      expect(toAlpha3(c.alpha3)).toBe(c.alpha3);
      expect(toAlpha3(c.name)).toBe(c.alpha3);
      if (c.alpha2) expect(toAlpha3(c.alpha2)).toBe(c.alpha3);
    }
  });
});
