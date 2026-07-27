import { describe, it, expect } from 'vitest';
import {
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  validateFieldDefinitions,
  validateFieldOptions,
} from '../../../components/secret-types/fieldOptionsValidation';
import type { FieldDefinition } from '../../../types';

// These assertions encode the API contract in
// apps/api/src/secret-types/dto/create-secret-type.dto.ts. If the server schema
// changes, these are the tests that should fail first.

const selectField: FieldDefinition = {
  name: 'card_network',
  label: 'Card Network',
  type: 'select',
  required: true,
  sensitive: false,
  options: ['Visa', 'Mastercard'],
};

const stringField: FieldDefinition = {
  name: 'username',
  label: 'Username',
  type: 'string',
  required: true,
  sensitive: false,
};

describe('validateFieldOptions', () => {
  it('accepts a select field with a non-empty, unique option list', () => {
    expect(validateFieldOptions(selectField).isValid).toBe(true);
  });

  it('requires options on select fields', () => {
    const { options: _dropped, ...noOptions } = selectField;

    expect(validateFieldOptions(noOptions).listError).toBe('Add at least one option');
    expect(validateFieldOptions({ ...selectField, options: [] }).listError).toBe(
      'Add at least one option',
    );
  });

  it('rejects options on non-select fields', () => {
    expect(validateFieldOptions(stringField).isValid).toBe(true);

    const withStaleOptions: FieldDefinition = { ...stringField, options: ['Visa'] };
    expect(validateFieldOptions(withStaleOptions).isValid).toBe(false);
    expect(validateFieldOptions(withStaleOptions).listError).toBe(
      'Options are only allowed on Select fields',
    );
  });

  it('rejects blank and whitespace-only options', () => {
    const result = validateFieldOptions({ ...selectField, options: ['Visa', '', '   '] });

    expect(result.optionErrors[0]).toBeNull();
    expect(result.optionErrors[1]).toBe('Option cannot be empty');
    expect(result.optionErrors[2]).toBe('Option cannot be empty');
    expect(result.isValid).toBe(false);
  });

  it(`rejects options longer than ${MAX_OPTION_LENGTH} characters`, () => {
    const atLimit = 'a'.repeat(MAX_OPTION_LENGTH);
    const overLimit = 'a'.repeat(MAX_OPTION_LENGTH + 1);

    expect(validateFieldOptions({ ...selectField, options: [atLimit] }).isValid).toBe(true);
    expect(
      validateFieldOptions({ ...selectField, options: [overLimit] }).optionErrors[0],
    ).toBe(`Options must be ${MAX_OPTION_LENGTH} characters or less`);
  });

  it('rejects duplicate values, flagging only the later occurrence', () => {
    const result = validateFieldOptions({
      ...selectField,
      options: ['Visa', 'Amex', 'Visa'],
    });

    expect(result.optionErrors[0]).toBeNull();
    expect(result.optionErrors[1]).toBeNull();
    expect(result.optionErrors[2]).toBe('This option is already in the list');
  });

  it(`rejects more than ${MAX_OPTIONS} options`, () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, i) => `Option ${i + 1}`);

    expect(
      validateFieldOptions({ ...selectField, options: build(MAX_OPTIONS) }).isValid,
    ).toBe(true);
    expect(
      validateFieldOptions({ ...selectField, options: build(MAX_OPTIONS + 1) }).listError,
    ).toBe(`A field can have at most ${MAX_OPTIONS} options`);
  });
});

describe('validateFieldDefinitions', () => {
  it('returns null when every field would be accepted by the API', () => {
    expect(validateFieldDefinitions([stringField, selectField])).toBeNull();
  });

  it('names the offending field in the message', () => {
    expect(
      validateFieldDefinitions([stringField, { ...selectField, options: [] }]),
    ).toBe('Card Network: Add at least one option');
  });

  it('falls back to the field name, then its position, when there is no label', () => {
    expect(
      validateFieldDefinitions([{ ...selectField, label: '', options: [] }]),
    ).toBe('card_network: Add at least one option');

    expect(
      validateFieldDefinitions([{ ...selectField, label: '', name: '', options: [] }]),
    ).toBe('Field 1: Add at least one option');
  });

  it('reports the first problem when several fields are invalid', () => {
    const message = validateFieldDefinitions([
      { ...selectField, label: 'Kind', name: 'kind', options: ['a', 'a'] },
      { ...selectField, options: [] },
    ]);

    expect(message).toBe('Kind: This option is already in the list');
  });
});
