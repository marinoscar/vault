import { describe, expect, it } from 'vitest';
import {
  SECRET_NAME_MAX,
  cleanSecretData,
  diffSecretValues,
  formatRelativeTime,
  formatSecretValueForCopy,
  isCardType,
  validateSecretFields,
  validateSecretForm,
} from '../../src/secrets/headless/secretFields.js';
import { maskLast4 } from '../../src/secrets/headless/masking.js';
import { deriveEntryKey, entryKeyBase } from '../../src/secrets/headless/keyValue.js';
import type { FieldDefinition } from '../../src/core/headless/types.js';

const FIELDS: FieldDefinition[] = [
  { name: 'user', label: 'User', type: 'string', required: true, sensitive: false },
  { name: 'port', label: 'Port', type: 'number', required: false, sensitive: false },
  { name: 'tier', label: 'Tier', type: 'select', required: false, sensitive: false, options: ['a', 'b'] },
  { name: 'open', label: 'Open', type: 'select', required: false, sensitive: false, options: [] },
  { name: 'until', label: 'Until', type: 'date', required: false, sensitive: false },
];

describe('validateSecretFields', () => {
  it('accepts valid and empty optional values', () => {
    expect(validateSecretFields(FIELDS, { user: 'x', port: '22', tier: 'a', open: 'any', until: '2027-01-31' })).toEqual({});
    expect(validateSecretFields(FIELDS, { user: 'x', port: '', tier: '' })).toEqual({});
  });

  it('flags a blank required field, a bad number, date and option', () => {
    expect(validateSecretFields(FIELDS, { user: '  ', port: 'x', tier: 'c', until: 'never' })).toEqual({
      user: 'User is required',
      port: 'Port must be a number',
      tier: 'Tier must be one of: a, b',
      until: 'Until must be a valid date',
    });
  });
});

describe('validateSecretForm', () => {
  it('bounds the name like the API', () => {
    const long = 'n'.repeat(SECRET_NAME_MAX + 1);
    const { errors, hasErrors } = validateSecretForm({ name: long, description: '', fields: [], data: {} });
    expect(hasErrors).toBe(true);
    expect(errors.name).toMatch(/at most 255/);
  });

  it('requires a type only when asked', () => {
    expect(validateSecretForm({ name: 'x', description: '', requireType: true, fields: [], data: {} }).errors.typeId).toBe('Type is required');
    expect(validateSecretForm({ name: 'x', description: '', fields: [], data: {} }).hasErrors).toBe(false);
  });
});

describe('cleanSecretData', () => {
  it('keeps declared non-empty fields only', () => {
    expect(cleanSecretData(FIELDS, { user: 'x', port: '', stale: 'y', tier: null })).toEqual({ user: 'x' });
  });
});

describe('diffSecretValues', () => {
  it('labels each field changed, added, removed or unchanged, in field order', () => {
    const diff = diffSecretValues(FIELDS.slice(0, 3), { user: 'a', port: 1 }, { user: 'b', tier: 'a' });
    expect(diff.map((d) => [d.field.name, d.change])).toEqual([
      ['user', 'changed'],
      ['port', 'removed'],
      ['tier', 'added'],
    ]);
    expect(diffSecretValues(FIELDS.slice(0, 1), { user: 'a' }, { user: 'a' })[0].change).toBe('unchanged');
  });
});

describe('formatSecretValueForCopy', () => {
  it('reformats card fields and leaves others verbatim', () => {
    expect(formatSecretValueForCopy('4242 4242 4242 4242', 'number')).toBe('4242424242424242');
    expect(formatSecretValueForCopy(' keep me ', 'password')).toBe(' keep me ');
  });
});

describe('isCardType', () => {
  it('matches the system Card type only', () => {
    expect(isCardType({ isSystem: true, name: 'Card' })).toBe(true);
    expect(isCardType({ isSystem: false, name: 'Card' })).toBe(false);
    expect(isCardType(null)).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime('2026-11-02T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-02T11:55:00Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-11-02T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-10-31T12:00:00Z', now)).toBe('2d ago');
  });
});

// ---------------------------------------------------------------------------
// keyvalue, country and the last-4 mask (issue #207)
// ---------------------------------------------------------------------------

const DETAILS: FieldDefinition = { name: 'details', label: 'Details', type: 'keyvalue', required: true, sensitive: false };
const OPTIONAL_DETAILS: FieldDefinition = { ...DETAILS, required: false };
const COUNTRY: FieldDefinition = {
  name: 'country',
  label: 'Country',
  type: 'string',
  required: false,
  sensitive: false,
  format: 'country',
};
const CLASS_ENTRY = { key: 'class', label: 'Class', value: 'B', sensitive: false };
const PIN_ENTRY = { key: 'pin', label: 'PIN', value: '0000-placeholder', sensitive: true };

describe('keyvalue fields', () => {
  it('validates required as at least one entry with a label or a value', () => {
    expect(validateSecretFields([DETAILS], { details: [] })).toEqual({ details: 'Details is required' });
    expect(validateSecretFields([DETAILS], {})).toEqual({ details: 'Details is required' });
    expect(
      validateSecretFields([DETAILS], { details: [{ key: '', label: '  ', value: '', sensitive: false }] }),
    ).toEqual({ details: 'Details is required' });
    expect(validateSecretFields([DETAILS], { details: [CLASS_ENTRY] })).toEqual({});
    expect(validateSecretFields([OPTIONAL_DETAILS], { details: [] })).toEqual({});
  });

  it('requires a label on every entry with a value', () => {
    expect(
      validateSecretFields([OPTIONAL_DETAILS], {
        details: [CLASS_ENTRY, { key: '', label: ' ', value: 'X1234567', sensitive: false }],
      }),
    ).toEqual({ details: 'Every Details entry needs a label' });
  });

  it('cleans entries: trims, drops empty rows, derives missing keys', () => {
    const cleaned = cleanSecretData([DETAILS], {
      details: [
        { key: 'class', label: ' Class ', value: ' B ', sensitive: false },
        { key: '', label: '', value: '   ', sensitive: false },
        { key: '', label: 'Class', value: 'C', sensitive: true },
      ],
    });
    expect(cleaned).toEqual({
      details: [
        { key: 'class', label: 'Class', value: 'B', sensitive: false },
        { key: 'class_2', label: 'Class', value: 'C', sensitive: true },
      ],
    });
  });

  it('omits an optional keyvalue field with no entry left', () => {
    expect(cleanSecretData([OPTIONAL_DETAILS], { details: [{ key: '', label: '', value: '', sensitive: false }] })).toEqual({});
  });

  it('diffs entries structurally, by key then label, value and sensitive', () => {
    const same = diffSecretValues([DETAILS], { details: [CLASS_ENTRY, PIN_ENTRY] }, { details: [PIN_ENTRY, CLASS_ENTRY] });
    expect(same[0].change).toBe('unchanged');
    expect(same[0].versionEntries).toEqual([CLASS_ENTRY, PIN_ENTRY]);
    expect(same[0].currentEntries).toEqual([PIN_ENTRY, CLASS_ENTRY]);

    const flipped = diffSecretValues([DETAILS], { details: [PIN_ENTRY] }, { details: [{ ...PIN_ENTRY, sensitive: false }] });
    expect(flipped[0].change).toBe('changed');
    const relabelled = diffSecretValues([DETAILS], { details: [CLASS_ENTRY] }, { details: [{ ...CLASS_ENTRY, label: 'Category' }] });
    expect(relabelled[0].change).toBe('changed');
    const rekeyed = diffSecretValues([DETAILS], { details: [CLASS_ENTRY] }, { details: [{ ...CLASS_ENTRY, key: 'category' }] });
    expect(rekeyed[0].change).toBe('changed');

    expect(diffSecretValues([DETAILS], {}, { details: [CLASS_ENTRY] })[0].change).toBe('added');
    expect(diffSecretValues([DETAILS], { details: [CLASS_ENTRY] }, { details: [] })[0].change).toBe('removed');
  });

  it('copies a whole keyvalue value as one line per entry', () => {
    expect(formatSecretValueForCopy([CLASS_ENTRY, PIN_ENTRY], 'details')).toBe('Class: B\nPIN: 0000-placeholder');
    // A single entry's own copy is its value, never reformatted as a card field.
    expect(formatSecretValueForCopy('X1234567')).toBe('X1234567');
  });
});

describe('country fields', () => {
  it('accepts an alpha-3 code of the table in any case, refuses anything else', () => {
    expect(validateSecretFields([COUNTRY], { country: 'UTO' })).toEqual({});
    expect(validateSecretFields([COUNTRY], { country: 'deu' })).toEqual({});
    expect(validateSecretFields([COUNTRY], { country: '' })).toEqual({});
    expect(validateSecretFields([COUNTRY], { country: 'DE' })).toEqual({
      country: 'Country must be a country code from the list',
    });
    expect(validateSecretFields([COUNTRY], { country: 'ZZZ' })).toHaveProperty('country');
  });
});

describe('maskLast4', () => {
  it('shows a fixed prefix and the last four non-space characters', () => {
    expect(maskLast4('X1234567')).toBe('•••• 4567');
    expect(maskLast4('X12 345 67')).toBe('•••• 4567');
    expect(maskLast4('ABCD')).toBe('••••');
    expect(maskLast4('AB')).toBe('••');
    expect(maskLast4('')).toBe('');
    expect(maskLast4(null)).toBe('');
  });

  it('groups the hidden part in fours on request (the card number display)', () => {
    expect(maskLast4('4242424242424242', { groupHidden: true })).toBe('•••• •••• •••• 4242');
    expect(maskLast4('378282246310005', { groupHidden: true })).toBe('•••• •••• ••• 0005');
  });
});

describe('entry keys', () => {
  it('derives a snake_case key from the label and dedupes it', () => {
    expect(entryKeyBase('Vehicle class')).toBe('vehicle_class');
    expect(entryKeyBase('  Ünïcode -- Label!! ')).toBe('unicode_label');
    expect(entryKeyBase('2nd line')).toBe('entry_2nd_line');
    expect(entryKeyBase('!!!')).toBe('');
    expect(deriveEntryKey('Class', ['class'])).toBe('class_2');
    expect(deriveEntryKey('Class', ['class', 'class_2'])).toBe('class_3');
    expect(deriveEntryKey('', [])).toBe('');
  });
});
