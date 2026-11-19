import { describe, expect, it } from 'vitest';

import { isCountryCode } from '../src/common/index.js';

import {
  FIELD_FORMATS,
  FIELD_MASKS,
  FIELD_TYPES,
  KEYVALUE_MAX_ENTRIES,
  KEYVALUE_RESERVED_MESSAGE,
  SYSTEM_SECRET_TYPES,
  createSecretTypeSchema,
  fieldDefinitionSchema,
  keyValueEntrySchema,
  keyValueValueSchema,
  secretTypeFieldsSchema,
  type SystemSecretType,
} from '../src/secret-types/index.js';

// Issue #206: the `keyvalue` field type, `format` and `mask`.

const entry = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  label: `Label ${key}`,
  value: `value-${key}`,
  sensitive: false,
  ...overrides,
});

describe('field model constants', () => {
  it('adds keyvalue to the field types and declares the formats and masks', () => {
    expect(FIELD_TYPES).toEqual(['string', 'number', 'date', 'select', 'keyvalue']);
    expect(FIELD_FORMATS).toEqual(['country', 'multiline']);
    expect(FIELD_MASKS).toEqual(['last4']);
    expect(KEYVALUE_MAX_ENTRIES).toBe(50);
  });
});

describe('keyvalue field definitions', () => {
  // A system-type-shaped definition (test only, not seeded).
  const systemShaped: SystemSecretType = {
    name: 'Test Document',
    description: 'A test-only system-type-shaped definition',
    icon: 'Badge',
    fields: [
      { name: 'document_number', label: 'Document Number', type: 'string', required: true, sensitive: true, mask: 'last4' },
      { name: 'issuing_country', label: 'Issuing Country', type: 'string', required: false, sensitive: false, format: 'country' },
      { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false, format: 'multiline' },
      { name: 'extra_fields', label: 'Additional fields', type: 'keyvalue', required: false, sensitive: false },
    ],
    allowAttachments: true,
  };

  it('accepts keyvalue, format and mask in a system-type-shaped definition', () => {
    expect(secretTypeFieldsSchema.safeParse(systemShaped.fields).success).toBe(true);
  });

  it('rejects keyvalue in a custom type with a clear message', () => {
    const result = createSecretTypeSchema.safeParse({ name: 'Custom', fields: systemShaped.fields });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toEqual([KEYVALUE_RESERVED_MESSAGE]);
  });

  it('still accepts format and mask in a custom type', () => {
    const fields = systemShaped.fields.filter((f) => f.type !== 'keyvalue');
    expect(createSecretTypeSchema.safeParse({ name: 'Custom', fields }).success).toBe(true);
  });

  it('keeps every built-in type valid', () => {
    for (const type of SYSTEM_SECRET_TYPES) {
      expect(secretTypeFieldsSchema.safeParse(type.fields).success, type.name).toBe(true);
    }
  });
});

describe('format and mask', () => {
  const base = { name: 'value', label: 'Value', required: false };

  it('allows format only on string fields', () => {
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', format: 'country' }).success).toBe(true);
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', format: 'multiline' }).success).toBe(true);
    for (const type of ['number', 'date', 'keyvalue']) {
      const result = fieldDefinitionSchema.safeParse({ ...base, type, format: 'multiline' });
      expect(result.success, type).toBe(false);
      expect(result.error!.issues[0]).toMatchObject({ path: ['format'], message: 'format is only allowed for string fields' });
    }
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'select', options: ['a'], format: 'country' }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', format: 'email' }).success).toBe(false);
  });

  it('allows mask only on sensitive string fields', () => {
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', sensitive: true, mask: 'last4' }).success).toBe(true);
    const notSensitive = fieldDefinitionSchema.safeParse({ ...base, type: 'string', sensitive: false, mask: 'last4' });
    expect(notSensitive.success).toBe(false);
    expect(notSensitive.error!.issues[0]).toMatchObject({ path: ['mask'], message: 'mask is only allowed for sensitive string fields' });
    // `sensitive` defaults to false, so an unflagged mask is rejected too.
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', mask: 'last4' }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'number', sensitive: true, mask: 'last4' }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...base, type: 'string', sensitive: true, mask: 'first4' }).success).toBe(false);
  });
});

describe('keyvalue values', () => {
  it('accepts a list of entries, including an empty one', () => {
    expect(keyValueValueSchema.safeParse([entry('member_number'), entry('plan_code', { sensitive: true })]).success).toBe(true);
    expect(keyValueValueSchema.safeParse([]).success).toBe(true);
  });

  it('validates each entry: snake_case key, a label, a bounded value and a sensitive flag', () => {
    expect(keyValueEntrySchema.safeParse(entry('a1_b')).success).toBe(true);
    expect(keyValueEntrySchema.safeParse(entry('Member')).success).toBe(false);
    expect(keyValueEntrySchema.safeParse(entry('1abc')).success).toBe(false);
    expect(keyValueEntrySchema.safeParse(entry(`k${'a'.repeat(50)}`)).success).toBe(false);
    expect(keyValueEntrySchema.safeParse(entry('a', { label: '' })).success).toBe(false);
    expect(keyValueEntrySchema.safeParse({ key: 'a', value: 'v', sensitive: false }).success).toBe(false);
    expect(keyValueEntrySchema.safeParse(entry('a', { value: 'v'.repeat(2001) })).success).toBe(false);
    expect(keyValueEntrySchema.safeParse(entry('a', { value: 'v'.repeat(2000) })).success).toBe(true);
    expect(keyValueEntrySchema.safeParse({ key: 'a', label: 'A', value: 'v' }).success).toBe(false);
  });

  it('rejects duplicate keys', () => {
    const result = keyValueValueSchema.safeParse([entry('member_number'), entry('member_number', { label: 'Other' })]);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toBe('Entry keys must be unique');
  });

  it('rejects more than 50 entries', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => entry(`key_${i}`));
    expect(keyValueValueSchema.safeParse(fifty).success).toBe(true);
    expect(keyValueValueSchema.safeParse([...fifty, entry('key_50')]).success).toBe(false);
  });

  it('rejects a value that is not a list', () => {
    expect(keyValueValueSchema.safeParse({ member_number: 'x' }).success).toBe(false);
    expect(keyValueValueSchema.safeParse('member_number=x').success).toBe(false);
  });
});

describe('country codes for format: country', () => {
  it('knows ISO alpha-3 codes and the UTO specimen state, not ZZZ', () => {
    expect(isCountryCode('UTO')).toBe(true);
    expect(isCountryCode('USA')).toBe(true);
    expect(isCountryCode('ZZZ')).toBe(false);
  });
});
