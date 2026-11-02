import { daysUntilExpiry, dueThreshold, formatCardExpiry, parseCardExpiry } from './card-expiry';

describe('card expiry arithmetic (issue #86)', () => {
  describe('parseCardExpiry', () => {
    it.each([
      ['7', '2027', { month: 7, year: 2027 }],
      ['07', '27', { month: 7, year: 2027 }],
      [12, 2030, { month: 12, year: 2030 }],
      [' 3 ', ' 2026 ', { month: 3, year: 2026 }],
    ])('reads %p / %p', (month, year, expected) => {
      expect(parseCardExpiry(month, year)).toEqual(expected);
    });

    it.each([
      ['13', '2027'],
      ['0', '2027'],
      ['07', '202'],
      ['07', 'next'],
      ['', ''],
      [undefined, '2027'],
      ['07', null],
      ['07', { year: 2027 }],
    ])('rejects %p / %p', (month, year) => {
      expect(parseCardExpiry(month, year)).toBeNull();
    });
  });

  it('formats MM/YYYY', () => {
    expect(formatCardExpiry({ month: 3, year: 2027 })).toBe('03/2027');
  });

  describe('daysUntilExpiry', () => {
    const expiry = { month: 6, year: 2027 }; // valid through 2027-06-30

    it('is 0 on the last day of the month and counts down to it', () => {
      expect(daysUntilExpiry(expiry, new Date('2027-06-30T23:59:00Z'))).toBe(0);
      expect(daysUntilExpiry(expiry, new Date('2027-06-23T00:00:00Z'))).toBe(7);
      expect(daysUntilExpiry(expiry, new Date('2027-05-31T12:00:00Z'))).toBe(30);
    });

    it('is negative once the month is over', () => {
      expect(daysUntilExpiry(expiry, new Date('2027-07-01T00:00:00Z'))).toBe(-1);
    });

    it('handles a leap February and a year end', () => {
      expect(daysUntilExpiry({ month: 2, year: 2028 }, new Date('2028-02-01T00:00:00Z'))).toBe(28);
      expect(daysUntilExpiry({ month: 12, year: 2027 }, new Date('2027-12-01T00:00:00Z'))).toBe(30);
    });
  });

  describe('dueThreshold', () => {
    const none = new Set<number>();

    it('is null before the first threshold and after expiry', () => {
      expect(dueThreshold(31, none)).toBeNull();
      expect(dueThreshold(-1, none)).toBeNull();
    });

    it('fires 30, 7 and 0 on their days', () => {
      expect(dueThreshold(30, none)).toBe(30);
      expect(dueThreshold(7, new Set([30]))).toBe(7);
      expect(dueThreshold(0, new Set([30, 7]))).toBe(0);
    });

    it('does not repeat a threshold that was notified', () => {
      expect(dueThreshold(30, new Set([30]))).toBeNull();
      expect(dueThreshold(20, new Set([30]))).toBeNull();
      expect(dueThreshold(0, new Set([0]))).toBeNull();
    });

    it('after a missed stretch sends only the most urgent warning once', () => {
      expect(dueThreshold(5, none)).toBe(7);
      expect(dueThreshold(5, new Set([7]))).toBeNull();
      expect(dueThreshold(0, new Set([30]))).toBe(0);
    });
  });
});
