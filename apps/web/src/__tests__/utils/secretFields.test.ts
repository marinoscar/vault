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
} from '../../utils/secretFields';
import type { FieldDefinition } from '../../types';

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
