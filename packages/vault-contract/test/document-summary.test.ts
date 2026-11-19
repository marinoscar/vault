import { describe, expect, it } from 'vitest';

import {
  daysUntilDate,
  documentExpiryLeadDays,
  documentExpiryStatus,
  documentSummaryItemSchema,
  documentSummaryResponseSchema,
  isExpiringDocumentTypeName,
  parseDocumentDate,
} from '../src/secrets/index.js';
import { ID_DOCUMENT_KINDS, ID_DOCUMENT_KIND_CATALOG, PASSPORT_EXPIRY_LEAD_DAYS } from '../src/secret-types/index.js';

describe('document expiry (IDOC-9)', () => {
  it('parses only real calendar dates', () => {
    expect(parseDocumentDate('2027-02-28')).toBe('2027-02-28');
    expect(parseDocumentDate(' 2028-02-29 ')).toBe('2028-02-29');
    expect(parseDocumentDate('2027-02-29')).toBeNull();
    expect(parseDocumentDate('2027-13-01')).toBeNull();
    expect(parseDocumentDate('02/2027')).toBeNull();
    expect(parseDocumentDate(20270101)).toBeNull();
    expect(parseDocumentDate(undefined)).toBeNull();
  });

  it('counts UTC calendar days around midnight', () => {
    expect(daysUntilDate('2027-07-10', new Date('2027-07-10T00:00:00Z'))).toBe(0);
    expect(daysUntilDate('2027-07-10', new Date('2027-07-10T23:59:59Z'))).toBe(0);
    expect(daysUntilDate('2027-07-10', new Date('2027-07-09T23:59:59Z'))).toBe(1);
    expect(daysUntilDate('2027-07-10', new Date('2027-07-11T00:00:00Z'))).toBe(-1);
    expect(daysUntilDate('2027-07-10', new Date('invalid'))).toBeNull();
    expect(daysUntilDate('not a date', new Date('2027-07-10T00:00:00Z'))).toBeNull();
  });

  it('takes the passport lead days, the catalog kind, or Other for an unknown kind', () => {
    expect(documentExpiryLeadDays('Passport', undefined)).toEqual(PASSPORT_EXPIRY_LEAD_DAYS);
    for (const kind of ID_DOCUMENT_KINDS) {
      expect(documentExpiryLeadDays('ID Document', kind)).toEqual(ID_DOCUMENT_KIND_CATALOG[kind].expiryLeadDays);
    }
    expect(documentExpiryLeadDays('ID Document', 'Library Card')).toEqual(ID_DOCUMENT_KIND_CATALOG.Other.expiryLeadDays);
    expect(documentExpiryLeadDays('ID Document', 'Social Security Card')).toEqual([]);
    expect(documentExpiryLeadDays('Card', 'Visa')).toEqual([]);
  });

  it('classifies a document within its largest lead day', () => {
    const today = new Date('2027-01-01T12:00:00Z');
    const passport = documentExpiryLeadDays('Passport', null);
    expect(documentExpiryStatus(null, passport, today)).toBe('no_expiry');
    expect(documentExpiryStatus('2026-12-31', passport, today)).toBe('expired');
    expect(documentExpiryStatus('2027-01-01', passport, today)).toBe('expiring_soon');
    expect(documentExpiryStatus('2027-09-28', passport, today)).toBe('expiring_soon'); // 270 days
    expect(documentExpiryStatus('2027-09-29', passport, today)).toBe('valid');
    expect(documentExpiryStatus('2027-01-02', [], today)).toBe('valid');
  });

  it('knows the two document types', () => {
    expect(isExpiringDocumentTypeName('Passport')).toBe(true);
    expect(isExpiringDocumentTypeName('ID Document')).toBe(true);
    expect(isExpiringDocumentTypeName('Card')).toBe(false);
  });

  it('rejects any extra field in a summary item', () => {
    const item = { id: 's1', name: 'Passport A', typeName: 'Passport', documentKind: null, expiryDate: '2030-01-01', status: 'valid' };
    expect(documentSummaryResponseSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(() => documentSummaryItemSchema.parse({ ...item, passportNumber: 'X' })).toThrow();
  });
});
