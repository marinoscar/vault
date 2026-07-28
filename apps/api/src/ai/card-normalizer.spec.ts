import { CARD_KINDS, CARD_NETWORKS } from '../common/constants/card.constants';
import {
  matchOption,
  mergeExtractions,
  normalizeCardNumber,
  normalizeExpMonth,
  normalizeExpYear,
  normalizeExtractions,
  passesLuhn,
} from './card-normalizer';
import { buildRawExtraction } from '../../test/mocks/ai-vision-provider.mock';

describe('card-normalizer', () => {
  describe('normalizeCardNumber', () => {
    it('strips spaces and dashes down to digits', () => {
      expect(normalizeCardNumber('4111 1111-1111 1111')).toBe(
        '4111111111111111',
      );
    });

    it('returns null when nothing numeric remains', () => {
      expect(normalizeCardNumber('----')).toBeNull();
      expect(normalizeCardNumber(null)).toBeNull();
    });
  });

  describe('normalizeExpMonth', () => {
    it('zero-pads a single digit month', () => {
      expect(normalizeExpMonth('7')).toBe('07');
    });

    it('passes a already-padded month through', () => {
      expect(normalizeExpMonth('11')).toBe('11');
    });

    it('recovers the month when the model returned the whole stamp', () => {
      expect(normalizeExpMonth('07/27')).toBe('07');
    });

    it('rejects an impossible month', () => {
      expect(normalizeExpMonth('13')).toBeNull();
      expect(normalizeExpMonth('0')).toBeNull();
    });
  });

  describe('normalizeExpYear', () => {
    it('expands a two-digit year into the 2000s', () => {
      expect(normalizeExpYear('27')).toBe('2027');
    });

    it('keeps a plausible four-digit year', () => {
      expect(normalizeExpYear('2031')).toBe('2031');
    });

    it('rejects an implausible year', () => {
      expect(normalizeExpYear('1998')).toBeNull();
      expect(normalizeExpYear('7')).toBeNull();
    });
  });

  describe('matchOption', () => {
    it('matches the shared constants case-insensitively', () => {
      expect(matchOption('mastercard', CARD_NETWORKS)).toEqual({
        value: 'Mastercard',
        unrecognised: false,
      });
      expect(matchOption('  american   express ', CARD_NETWORKS)).toEqual({
        value: 'American Express',
        unrecognised: false,
      });
      expect(matchOption('DEBIT', CARD_KINDS)).toEqual({
        value: 'Debit',
        unrecognised: false,
      });
    });

    it('returns the exact seeded casing, not the model casing', () => {
      // The value is POSTed to /api/secrets, where the select option list comes
      // from the same constants. A case mismatch here is a 400 on save.
      const result = matchOption('VISA', CARD_NETWORKS);
      expect(result.value).toBe('Visa');
      expect(CARD_NETWORKS).toContain(result.value as string);
    });

    it('falls back to Other for an unrecognised value', () => {
      expect(matchOption('Bitcoin', CARD_NETWORKS)).toEqual({
        value: 'Other',
        unrecognised: true,
      });
    });

    it('leaves null alone', () => {
      expect(matchOption(null, CARD_NETWORKS)).toEqual({
        value: null,
        unrecognised: false,
      });
    });
  });

  describe('passesLuhn', () => {
    it('accepts a valid number', () => {
      expect(passesLuhn('4111111111111111')).toBe(true);
    });

    it('rejects a number with a misread digit', () => {
      expect(passesLuhn('4111111111111112')).toBe(false);
    });
  });

  describe('mergeExtractions', () => {
    it('prefers the higher-confidence source per field', () => {
      const front = buildRawExtraction(
        { cardholder_name: 'FRONT NAME', number: '4111111111111111' },
        { cardholder_name: 0.4, number: 0.95 },
      );
      const back = buildRawExtraction(
        { cardholder_name: 'BACK NAME', issuing_bank: 'Example Bank' },
        { cardholder_name: 0.9, issuing_bank: 0.8 },
      );

      const merged = mergeExtractions([front, back]);

      expect(merged.fields.cardholder_name).toBe('BACK NAME');
      expect(merged.fields.number).toBe('4111111111111111');
      expect(merged.fields.issuing_bank).toBe('Example Bank');
    });

    it('never lets a null win, however confident the source claims to be', () => {
      const front = buildRawExtraction({ number: null }, { number: 1 });
      const back = buildRawExtraction({ number: '4111111111111111' }, { number: 0.1 });

      expect(mergeExtractions([front, back]).fields.number).toBe(
        '4111111111111111',
      );
    });

    it('dedupes warnings across sources', () => {
      const a = buildRawExtraction({}, {}, { warnings: ['Glare on the card'] });
      const b = buildRawExtraction({}, {}, { warnings: ['Glare on the card'] });

      expect(mergeExtractions([a, b]).warnings).toEqual(['Glare on the card']);
    });

    it('merges notes like any other field: higher-confidence source wins, no enum matching applied', () => {
      const front = buildRawExtraction(
        { notes: '1-800-555-0100' },
        { notes: 0.4 },
      );
      const back = buildRawExtraction(
        { notes: 'Member Since 2019\nsupportbank.example.com' },
        { notes: 0.9 },
      );

      const merged = mergeExtractions([front, back]);

      expect(merged.fields.notes).toBe('Member Since 2019\nsupportbank.example.com');
      expect(merged.confidence.notes).toBeCloseTo(0.9);
    });
  });

  describe('normalizeExtractions', () => {
    it('normalizes a clean front-only read', () => {
      const result = normalizeExtractions([
        buildRawExtraction(
          {
            cardholder_name: 'ADA LOVELACE',
            number: '4111 1111 1111 1111',
            exp_month: '7',
            exp_year: '27',
            card_network: 'visa',
            card_kind: 'credit',
          },
          {
            cardholder_name: 0.9,
            number: 0.98,
            exp_month: 0.9,
            exp_year: 0.9,
            card_network: 0.95,
            card_kind: 0.7,
          },
        ),
      ]);

      expect(result.fields).toMatchObject({
        cardholder_name: 'ADA LOVELACE',
        number: '4111111111111111',
        exp_month: '07',
        exp_year: '2027',
        card_network: 'Visa',
        card_kind: 'Credit',
      });
      expect(result.partial).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('warns rather than failing when the checksum does not hold', () => {
      const result = normalizeExtractions([
        buildRawExtraction({ number: '4111111111111112' }, { number: 0.9 }),
      ]);

      expect(result.fields.number).toBe('4111111111111112');
      expect(result.warnings.join(' ')).toContain('checksum');
      expect(result.partial).toBe(false);
    });

    it('warns when an unrecognised network is coerced to Other', () => {
      const result = normalizeExtractions([
        buildRawExtraction({ card_network: 'Bitcoin' }, { card_network: 0.5 }),
      ]);

      expect(result.fields.card_network).toBe('Other');
      expect(result.warnings.join(' ')).toContain('not recognised');
    });

    it('zeroes the confidence of a value that normalized away', () => {
      const result = normalizeExtractions([
        buildRawExtraction({ exp_month: '19' }, { exp_month: 0.8 }),
      ]);

      expect(result.fields.exp_month).toBeNull();
      expect(result.confidence.exp_month).toBe(0);
    });

    it('flags partial when every field came back null', () => {
      const result = normalizeExtractions([buildRawExtraction()]);

      expect(result.partial).toBe(true);
      expect(Object.values(result.fields).every((v) => v === null)).toBe(true);
    });

    it('passes notes through untouched - no enum matching, no reformatting', () => {
      const raw = 'Member Since 2019\nCustomer Service: 1-800-555-0100\nbank.example.com';
      const result = normalizeExtractions([
        buildRawExtraction({ notes: raw }, { notes: 0.85 }),
      ]);

      expect(result.fields.notes).toBe(raw);
      expect(result.confidence.notes).toBeCloseTo(0.85);
    });

    it('keeps notes confidence at 0 when notes is null', () => {
      const result = normalizeExtractions([
        buildRawExtraction({ notes: null }, { notes: 0.7 }),
      ]);

      expect(result.fields.notes).toBeNull();
      expect(result.confidence.notes).toBe(0);
    });
  });
});
