import { describe, it, expect } from 'vitest';
import {
  formatCardNumberForCopy,
  formatSecurityCodeForCopy,
  formatExpiryForCopy,
  formatExpiryMonthForCopy,
  formatExpiryYearShortForCopy,
  formatExpiryYearLongForCopy,
  maskCardNumber,
} from '../../utils/cardFormat';

/**
 * Values reach these helpers from a Record<string, unknown>, so each formatter
 * is exercised with the absent / wrong-typed inputs an older card secret can
 * legitimately produce.
 */
const MALFORMED_INPUTS: unknown[] = [
  undefined,
  null,
  '',
  '   ',
  'not a card',
  {},
  [],
  true,
  false,
  Number.NaN,
  Number.POSITIVE_INFINITY,
];

describe('cardFormat', () => {
  describe('formatCardNumberForCopy', () => {
    it('should return a plain card number unchanged', () => {
      expect(formatCardNumberForCopy('4242424242424242')).toBe('4242424242424242');
    });

    it('should strip spaces from a grouped card number', () => {
      expect(formatCardNumberForCopy('4242 4242 4242 4242')).toBe('4242424242424242');
    });

    it('should strip dashes from a hyphenated card number', () => {
      expect(formatCardNumberForCopy('4242-4242-4242-4242')).toBe('4242424242424242');
    });

    it('should strip surrounding whitespace', () => {
      expect(formatCardNumberForCopy('  4242 4242 4242 4242  ')).toBe('4242424242424242');
    });

    it('should handle a 15-digit Amex number', () => {
      expect(formatCardNumberForCopy('3782 822463 10005')).toBe('378282246310005');
    });

    it('should accept a number-typed stored value', () => {
      expect(formatCardNumberForCopy(4242424242424242)).toBe('4242424242424242');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(formatCardNumberForCopy(input)).toBe('');
    });

    it('should not throw on any malformed input', () => {
      for (const input of MALFORMED_INPUTS) {
        expect(() => formatCardNumberForCopy(input)).not.toThrow();
      }
    });
  });

  describe('formatSecurityCodeForCopy', () => {
    it('should return a 3-digit CVV unchanged', () => {
      expect(formatSecurityCodeForCopy('123')).toBe('123');
    });

    it('should return a 4-digit Amex CID unchanged', () => {
      expect(formatSecurityCodeForCopy('1234')).toBe('1234');
    });

    it('should strip non-digits', () => {
      expect(formatSecurityCodeForCopy(' 1-2-3 ')).toBe('123');
    });

    it('should preserve a leading zero', () => {
      expect(formatSecurityCodeForCopy('012')).toBe('012');
    });

    it('should accept a number-typed stored value', () => {
      expect(formatSecurityCodeForCopy(123)).toBe('123');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(formatSecurityCodeForCopy(input)).toBe('');
    });
  });

  describe('formatExpiryMonthForCopy', () => {
    it('should zero-pad a single-digit month', () => {
      expect(formatExpiryMonthForCopy('3')).toBe('03');
    });

    it('should leave an already padded month unchanged', () => {
      expect(formatExpiryMonthForCopy('03')).toBe('03');
    });

    it('should handle December', () => {
      expect(formatExpiryMonthForCopy('12')).toBe('12');
    });

    it('should accept a number-typed month', () => {
      expect(formatExpiryMonthForCopy(7)).toBe('07');
    });

    it('should reject month 0', () => {
      expect(formatExpiryMonthForCopy('0')).toBe('');
    });

    it('should reject a month above 12', () => {
      expect(formatExpiryMonthForCopy('13')).toBe('');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(formatExpiryMonthForCopy(input)).toBe('');
    });
  });

  describe('formatExpiryYearShortForCopy', () => {
    it('should shorten a 4-digit year', () => {
      expect(formatExpiryYearShortForCopy('2029')).toBe('29');
    });

    it('should leave a 2-digit year unchanged', () => {
      expect(formatExpiryYearShortForCopy('29')).toBe('29');
    });

    it('should accept a number-typed year', () => {
      expect(formatExpiryYearShortForCopy(2029)).toBe('29');
    });

    it('should reject a 3-digit year', () => {
      expect(formatExpiryYearShortForCopy('202')).toBe('');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(formatExpiryYearShortForCopy(input)).toBe('');
    });
  });

  describe('formatExpiryYearLongForCopy', () => {
    it('should expand a 2-digit year into the 2000s', () => {
      expect(formatExpiryYearLongForCopy('29')).toBe('2029');
    });

    it('should leave a 4-digit year unchanged', () => {
      expect(formatExpiryYearLongForCopy('2029')).toBe('2029');
    });

    it('should accept a number-typed year', () => {
      expect(formatExpiryYearLongForCopy(29)).toBe('2029');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(formatExpiryYearLongForCopy(input)).toBe('');
    });
  });

  describe('formatExpiryForCopy', () => {
    it('should combine month and 4-digit year as MM/YY', () => {
      expect(formatExpiryForCopy('3', '2029')).toBe('03/29');
    });

    it('should combine month and 2-digit year as MM/YY', () => {
      expect(formatExpiryForCopy('12', '29')).toBe('12/29');
    });

    it('should accept number-typed month and year', () => {
      expect(formatExpiryForCopy(7, 2031)).toBe('07/31');
    });

    it('should return empty string when the month is missing', () => {
      expect(formatExpiryForCopy(undefined, '2029')).toBe('');
    });

    it('should return empty string when the year is missing', () => {
      expect(formatExpiryForCopy('03', undefined)).toBe('');
    });

    it('should return empty string rather than a half-formed value for an invalid month', () => {
      expect(formatExpiryForCopy('13', '2029')).toBe('');
    });

    it('should return empty string for an invalid year', () => {
      expect(formatExpiryForCopy('03', 'abcd')).toBe('');
    });

    it('should return empty string when both parts are malformed', () => {
      expect(formatExpiryForCopy(null, {})).toBe('');
    });
  });

  describe('maskCardNumber', () => {
    it('should mask all but the last four digits of a 16-digit number', () => {
      expect(maskCardNumber('4242424242424242')).toBe('•••• •••• •••• 4242');
    });

    it('should mask a number that was stored with spaces', () => {
      expect(maskCardNumber('4242 4242 4242 4242')).toBe('•••• •••• •••• 4242');
    });

    it('should keep the visible digits in one group for a 15-digit Amex', () => {
      expect(maskCardNumber('378282246310005')).toBe('•••• •••• ••• 0005');
    });

    it('should mask a short number entirely rather than exposing it as last four', () => {
      expect(maskCardNumber('4242')).toBe('••••');
    });

    it('should mask a number shorter than four digits entirely', () => {
      expect(maskCardNumber('42')).toBe('••');
    });

    it('should reveal only four digits regardless of length', () => {
      const masked = maskCardNumber('4111111111111111');
      expect(masked.replace(/[^0-9]/g, '')).toBe('1111');
    });

    it.each(MALFORMED_INPUTS.map((v) => [v]))('should return empty string for malformed input %p', (input) => {
      expect(maskCardNumber(input)).toBe('');
    });

    it('should never include the leading digits of the card', () => {
      expect(maskCardNumber('4242424242424242')).not.toContain('42424242');
    });
  });
});
