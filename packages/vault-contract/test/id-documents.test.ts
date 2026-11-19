import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_CHECK_IDS,
  ID_DOCUMENT_KINDS,
  ID_DOCUMENT_KIND_CATALOG,
  PASSPORT_EXPIRY_LEAD_DAYS,
  SYSTEM_SECRET_TYPES,
  isIdDocumentKind,
  keyValueEntrySchema,
  secretTypeFieldsSchema,
  standardAttributeKeysFor,
} from '../src/secret-types/index.js';

const typeNamed = (name: string) => SYSTEM_SECRET_TYPES.find((type) => type.name === name)!;

describe('the document kind catalog (issue #209)', () => {
  it('pins the kinds, in order', () => {
    expect(ID_DOCUMENT_KINDS).toEqual([
      'Driver License',
      'National ID',
      'Permanent Resident Card',
      'Trusted Traveler Card',
      'Social Security Card',
      'Health Insurance Card',
      'Visa',
      'Work Permit',
      'Residence Permit',
      'Vehicle Registration',
      'Military ID',
      'Student ID',
      'Other',
    ]);
    expect(Object.keys(ID_DOCUMENT_KIND_CATALOG).sort()).toEqual([...ID_DOCUMENT_KINDS].sort());
    for (const kind of ID_DOCUMENT_KINDS) expect(ID_DOCUMENT_KIND_CATALOG[kind].kind).toBe(kind);
  });

  it('pins the check ids', () => {
    expect(DOCUMENT_CHECK_IDS).toEqual(['mrz', 'ssn', 'vin']);
  });

  it('pins the standard keys of every kind; 🔒 marks the sensitive ones', () => {
    const keys = Object.fromEntries(
      ID_DOCUMENT_KINDS.map((kind) => [
        kind,
        ID_DOCUMENT_KIND_CATALOG[kind].standardKeys.map((k) => (k.sensitive ? `${k.key} 🔒` : k.key)),
      ]),
    );
    expect(keys).toEqual({
      'Driver License': ['license_class', 'restrictions', 'endorsements', 'address', 'sex', 'height', 'eye_color', 'organ_donor'],
      'National ID': ['address', 'sex', 'nationality', 'mrz 🔒'],
      'Permanent Resident Card': ['uscis_number 🔒', 'category', 'resident_since', 'country_of_birth', 'sex', 'mrz 🔒'],
      'Trusted Traveler Card': ['ktn 🔒', 'program', 'mrz 🔒'],
      'Social Security Card': [],
      'Health Insurance Card': [
        'member_id 🔒',
        'group_number',
        'payer',
        'plan',
        'rx_bin',
        'rx_pcn',
        'rx_group',
        'phone_member_services',
        'phone_provider',
      ],
      Visa: ['visa_type', 'entries', 'annotation', 'control_number', 'mrz 🔒'],
      'Work Permit': ['category', 'card_number', 'mrz 🔒'],
      'Residence Permit': ['category', 'card_number', 'mrz 🔒'],
      'Vehicle Registration': ['vin', 'plate', 'make', 'model', 'year', 'registered_owner'],
      'Military ID': ['rank_or_program', 'institution'],
      'Student ID': ['rank_or_program', 'institution'],
      Other: [],
    });
  });

  it('gives every standard key a snake_case key, unique per kind, that a keyvalue entry accepts', () => {
    for (const kind of ID_DOCUMENT_KINDS) {
      const standard = ID_DOCUMENT_KIND_CATALOG[kind].standardKeys;
      expect(new Set(standard.map((k) => k.key)).size, kind).toBe(standard.length);
      for (const entry of standard) {
        expect(entry.key, kind).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(keyValueEntrySchema.safeParse({ ...entry, value: '' }).success, `${kind}.${entry.key}`).toBe(true);
      }
    }
  });

  it('pins the checks of every kind, all of them known check ids', () => {
    const checks = Object.fromEntries(ID_DOCUMENT_KINDS.map((kind) => [kind, [...ID_DOCUMENT_KIND_CATALOG[kind].checks]]));
    expect(checks).toEqual({
      'Driver License': [],
      'National ID': ['mrz'],
      'Permanent Resident Card': ['mrz'],
      'Trusted Traveler Card': ['mrz'],
      'Social Security Card': ['ssn'],
      'Health Insurance Card': [],
      Visa: ['mrz'],
      'Work Permit': ['mrz'],
      'Residence Permit': ['mrz'],
      'Vehicle Registration': ['vin'],
      'Military ID': [],
      'Student ID': [],
      Other: [],
    });
  });

  it('pins the expiry lead days, each list descending', () => {
    const leads = Object.fromEntries(
      ID_DOCUMENT_KINDS.map((kind) => [kind, [...ID_DOCUMENT_KIND_CATALOG[kind].expiryLeadDays]]),
    );
    expect(leads).toEqual({
      'Driver License': [90, 30, 7, 0],
      'National ID': [90, 30, 7, 0],
      'Permanent Resident Card': [180, 90, 30, 0],
      'Trusted Traveler Card': [180, 90, 30, 0],
      'Social Security Card': [],
      'Health Insurance Card': [30, 0],
      Visa: [90, 30, 7, 0],
      'Work Permit': [90, 30, 7, 0],
      'Residence Permit': [90, 30, 7, 0],
      'Vehicle Registration': [30, 7, 0],
      'Military ID': [30, 0],
      'Student ID': [30, 0],
      Other: [30, 0],
    });
    expect(PASSPORT_EXPIRY_LEAD_DAYS).toEqual([270, 180, 90, 30, 0]);
    for (const list of [...Object.values(leads), [...PASSPORT_EXPIRY_LEAD_DAYS]]) {
      expect(list).toEqual([...list].sort((a, b) => b - a));
    }
  });

  it('answers the standard keys of a kind, and none for an unknown one', () => {
    expect(isIdDocumentKind('Visa')).toBe(true);
    expect(isIdDocumentKind('Library Card')).toBe(false);
    expect(isIdDocumentKind(undefined)).toBe(false);
    expect(standardAttributeKeysFor('Trusted Traveler Card').map((k) => k.key)).toEqual(['ktn', 'program', 'mrz']);
    expect(standardAttributeKeysFor('Library Card')).toEqual([]);
    expect(standardAttributeKeysFor(null)).toEqual([]);
  });
});

describe('the Passport and ID Document system types (issue #209)', () => {
  it('appends both types after the existing ones', () => {
    const names = SYSTEM_SECRET_TYPES.map((type) => type.name);
    expect(names.slice(-2)).toEqual(['Passport', 'ID Document']);
    expect(names.indexOf('Document')).toBeLessThan(names.indexOf('Passport'));
  });

  it('pins the Passport fields', () => {
    const passport = typeNamed('Passport');
    expect(passport).toMatchObject({
      icon: 'TravelExplore',
      description: 'Passport details and data page photo',
      allowAttachments: true,
    });
    expect(passport.fields.map((f) => f.name)).toEqual([
      'surname',
      'given_names',
      'passport_number',
      'passport_type',
      'issuing_country',
      'nationality',
      'date_of_birth',
      'place_of_birth',
      'sex',
      'issue_date',
      'expiry_date',
      'issuing_authority',
      'personal_number',
      'mrz',
      'notes',
    ]);
    expect(passport.fields.filter((f) => f.required).map((f) => f.name)).toEqual(['surname', 'passport_number', 'expiry_date']);
    expect(passport.fields.filter((f) => f.sensitive).map((f) => f.name)).toEqual([
      'passport_number',
      'date_of_birth',
      'personal_number',
      'mrz',
    ]);
    const field = (name: string) => passport.fields.find((f) => f.name === name)!;
    expect(field('passport_number').mask).toBe('last4');
    expect(field('issuing_country').format).toBe('country');
    expect(field('nationality').format).toBe('country');
    expect(field('mrz').format).toBe('multiline');
    expect(field('notes').format).toBe('multiline');
    expect(field('sex')).toMatchObject({ type: 'select', options: ['M', 'F', 'X'] });
    expect(['date_of_birth', 'issue_date', 'expiry_date'].map((n) => field(n).type)).toEqual(['date', 'date', 'date']);
  });

  it('pins the ID Document fields', () => {
    const doc = typeNamed('ID Document');
    expect(doc).toMatchObject({
      icon: 'AssignmentInd',
      description:
        'Driver license, ID card, Green Card, Global Entry, Social Security, insurance and other ID documents',
      allowAttachments: true,
    });
    expect(doc.fields.map((f) => f.name)).toEqual([
      'document_kind',
      'holder_name',
      'document_number',
      'issuing_country',
      'issuing_authority',
      'date_of_birth',
      'issue_date',
      'expiry_date',
      'attributes',
      'notes',
    ]);
    expect(doc.fields.filter((f) => f.required).map((f) => f.name)).toEqual(['document_kind', 'holder_name']);
    expect(doc.fields.filter((f) => f.sensitive).map((f) => f.name)).toEqual(['document_number', 'date_of_birth']);
    const field = (name: string) => doc.fields.find((f) => f.name === name)!;
    expect(field('document_kind')).toMatchObject({ type: 'select', options: [...ID_DOCUMENT_KINDS] });
    expect(field('document_number').mask).toBe('last4');
    expect(field('issuing_country').format).toBe('country');
    expect(field('attributes').type).toBe('keyvalue');
    expect(field('notes').format).toBe('multiline');
  });

  it('declares fields the field schema accepts (keyvalue is allowed on a system type)', () => {
    for (const name of ['Passport', 'ID Document']) {
      expect(secretTypeFieldsSchema.safeParse(typeNamed(name).fields).success, name).toBe(true);
    }
  });
});
