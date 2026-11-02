import { describe, expect, it } from 'vitest';

import {
  CARD_KINDS,
  CARD_NETWORKS,
  SYSTEM_SECRET_TYPES,
  createSecretTypeSchema,
  fieldDefinitionSchema,
  secretTypeFieldsSchema,
  secretTypeQuerySchema,
  updateSecretTypeSchema,
} from '../src/secret-types/index.js';

describe('system secret types', () => {
  it('names the six built-in types once each', () => {
    const names = SYSTEM_SECRET_TYPES.map((type) => type.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Credential', 'API Key', 'Card']));
  });

  it('gives every type unique snake_case field names that the field schema accepts', () => {
    for (const type of SYSTEM_SECRET_TYPES) {
      const names = type.fields.map((field) => field.name);
      expect(new Set(names).size, type.name).toBe(names.length);
      expect(secretTypeFieldsSchema.safeParse(type.fields).success, type.name).toBe(true);
    }
  });

  it('takes the Card network and kind options from the card constants', () => {
    const card = SYSTEM_SECRET_TYPES.find((type) => type.name === 'Card')!;
    expect(card.fields.find((f) => f.name === 'card_network')?.options).toEqual([...CARD_NETWORKS]);
    expect(card.fields.find((f) => f.name === 'card_kind')?.options).toEqual([...CARD_KINDS]);
  });

  it('marks card number and CVV sensitive', () => {
    const card = SYSTEM_SECRET_TYPES.find((type) => type.name === 'Card')!;
    const sensitive = card.fields.filter((f) => f.sensitive).map((f) => f.name);
    expect(sensitive).toEqual(expect.arrayContaining(['number', 'cvv']));
  });
});

describe('secret type schemas', () => {
  const field = { name: 'token', label: 'Token', type: 'string', required: true };

  it('defaults sensitive to false and rejects a non-snake_case name', () => {
    expect(fieldDefinitionSchema.parse(field).sensitive).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...field, name: 'Token' }).success).toBe(false);
  });

  it('requires options on select fields and forbids them elsewhere', () => {
    expect(fieldDefinitionSchema.safeParse({ ...field, type: 'select' }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...field, type: 'select', options: ['a', 'a'] }).success).toBe(false);
    expect(fieldDefinitionSchema.safeParse({ ...field, type: 'select', options: ['a', 'b'] }).success).toBe(true);
    expect(fieldDefinitionSchema.safeParse({ ...field, options: ['a'] }).success).toBe(false);
  });

  it('rejects empty and duplicate field lists', () => {
    expect(secretTypeFieldsSchema.safeParse([]).success).toBe(false);
    expect(secretTypeFieldsSchema.safeParse([field, field]).success).toBe(false);
  });

  it('parses create and update bodies', () => {
    expect(createSecretTypeSchema.parse({ name: 'Wifi', fields: [field] }).allowAttachments).toBe(false);
    expect(updateSecretTypeSchema.parse({ description: null }).description).toBeNull();
    expect(secretTypeQuerySchema.parse({}).includeSystem).toBe(true);
  });
});
