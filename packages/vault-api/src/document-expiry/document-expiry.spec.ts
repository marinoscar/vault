import { ID_DOCUMENT_KINDS, ID_DOCUMENT_KIND_CATALOG, PASSPORT_EXPIRY_LEAD_DAYS } from '@marinoscar/vault-contract/secret-types';

import { DOCUMENT_EXPIRED_GRACE_DAYS, daysUntilDate, dueThreshold, leadDaysFor } from './document-expiry';

describe('document expiry arithmetic (IDOC-9)', () => {
  describe('daysUntilDate', () => {
    it.each([
      ['2027-07-10', '2027-07-10T00:00:00.000Z', 0],
      ['2027-07-10', '2027-07-10T23:59:59.999Z', 0],
      ['2027-07-10', '2027-07-09T23:59:59.999Z', 1],
      ['2027-07-10', '2027-07-11T00:00:00.000Z', -1],
      ['2028-03-01', '2028-02-28T12:00:00.000Z', 2], // leap year
      ['2027-01-01', '2026-12-31T23:30:00.000Z', 1],
    ])('%s seen at %s is %i day(s) away', (date, now, expected) => {
      expect(daysUntilDate(date, new Date(now))).toBe(expected);
    });

    it('is null for an invalid date', () => {
      expect(daysUntilDate('2027-02-30', new Date('2027-01-01T00:00:00Z'))).toBeNull();
      expect(daysUntilDate('soon', new Date('2027-01-01T00:00:00Z'))).toBeNull();
    });
  });

  describe('leadDaysFor', () => {
    it('gives a passport its own lead days', () => {
      expect(leadDaysFor('Passport', undefined)).toEqual(PASSPORT_EXPIRY_LEAD_DAYS);
    });

    it.each(ID_DOCUMENT_KINDS.map((kind) => [kind]))('gives an ID Document of kind %s its catalog lead days', (kind) => {
      expect(leadDaysFor('ID Document', kind)).toEqual(ID_DOCUMENT_KIND_CATALOG[kind].expiryLeadDays);
    });

    it('falls back to Other for an unknown or missing kind', () => {
      expect(leadDaysFor('ID Document', 'Library Card')).toEqual(ID_DOCUMENT_KIND_CATALOG.Other.expiryLeadDays);
      expect(leadDaysFor('ID Document', null)).toEqual(ID_DOCUMENT_KIND_CATALOG.Other.expiryLeadDays);
    });

    it('has none for a Social Security Card or another type', () => {
      expect(leadDaysFor('ID Document', 'Social Security Card')).toEqual([]);
      expect(leadDaysFor('Card', 'Visa')).toEqual([]);
    });
  });

  describe('dueThreshold', () => {
    const lead = [90, 30, 7, 0];

    it('is null before the first lead day', () => {
      expect(dueThreshold(91, lead, new Set())).toBeNull();
    });

    it('fires each lead day on its day', () => {
      expect(dueThreshold(90, lead, new Set())).toBe(90);
      expect(dueThreshold(30, lead, new Set([90]))).toBe(30);
      expect(dueThreshold(7, lead, new Set([90, 30]))).toBe(7);
      expect(dueThreshold(0, lead, new Set([90, 30, 7]))).toBe(0);
    });

    it('notifies once for the smallest reached lead day when several were skipped, and never repeats', () => {
      // Saved 20 days before expiry: 90 and 30 were both passed; one message, for 30.
      expect(dueThreshold(20, lead, new Set())).toBe(30);
      const notified = new Set([30]);
      for (let days = 19; days > 7; days -= 1) {
        expect(dueThreshold(days, lead, notified)).toBeNull();
      }
      expect(dueThreshold(7, lead, notified)).toBe(7);
    });

    it('treats a recently expired document as the 0 lead day, once, and ignores a long-expired one', () => {
      expect(dueThreshold(-3, lead, new Set([90, 30, 7]))).toBe(0);
      expect(dueThreshold(-4, lead, new Set([0]))).toBeNull();
      expect(dueThreshold(-DOCUMENT_EXPIRED_GRACE_DAYS - 1, lead, new Set())).toBeNull();
    });

    it('restarts for a renewed document (a new expiry has an empty notified set)', () => {
      // The handler keys the notified set by expiry date: a new date starts from nothing.
      const byExpiry = new Map([['2027-07-10', new Set([90, 30, 7, 0])]]);
      expect(dueThreshold(90, lead, byExpiry.get('2037-07-10') ?? new Set())).toBe(90);
    });

    it('is null for a kind with no lead days', () => {
      expect(dueThreshold(0, [], new Set())).toBeNull();
    });
  });
});
