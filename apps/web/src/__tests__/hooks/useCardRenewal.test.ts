import { describe, expect, it } from 'vitest';

import {
  CVV_FIELD,
  diffCardFields,
  toCurrentValues,
  toRenewalValues,
  wasAiAssisted,
} from '../../hooks/useCardRenewal';
import type { CardExtractionResult, FieldDefinition } from '../../types';

const FIELDS: FieldDefinition[] = [
  { name: 'card_network', label: 'Network', type: 'select', required: false, sensitive: false, options: ['Visa'] },
  { name: 'cardholder_name', label: 'Cardholder Name', type: 'string', required: true, sensitive: false },
  { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true },
  { name: 'exp_month', label: 'Expiration Month', type: 'string', required: true, sensitive: false },
  { name: 'exp_year', label: 'Expiration Year', type: 'string', required: true, sensitive: false },
  { name: CVV_FIELD, label: 'CVV / CVC', type: 'string', required: true, sensitive: true },
  { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
];

const CURRENT = {
  card_network: 'Visa',
  cardholder_name: 'ADA LOVELACE',
  number: '4242424242424242',
  exp_month: '07',
  exp_year: '2026',
  cvv: '123',
  notes: 'Travel card',
};

function extraction(
  fields: Partial<CardExtractionResult['fields']>,
): CardExtractionResult {
  return {
    fields: {
      cardholder_name: null,
      number: null,
      exp_month: null,
      exp_year: null,
      card_network: null,
      card_kind: null,
      issuing_bank: null,
      security_code_2: null,
      ...fields,
    } as CardExtractionResult['fields'],
    confidence: {} as CardExtractionResult['confidence'],
    warnings: [],
    model: 'gpt-4o-mini',
    partial: false,
  };
}

describe('toCurrentValues', () => {
  it('flattens stored values to strings, keyed by the type', () => {
    const current = toCurrentValues(FIELDS, {
      cardholder_name: 'ADA LOVELACE',
      // Numbers are a legitimate stored shape for an expiry.
      exp_month: 7,
      number: '4242424242424242',
    });

    expect(current.cardholder_name).toBe('ADA LOVELACE');
    expect(current.exp_month).toBe('7');
    // Declared but absent becomes '' rather than undefined.
    expect(current.notes).toBe('');
  });

  it('drops stored keys the type no longer declares', () => {
    // The API rejects an unknown field name outright, so a leftover value must
    // never ride along into the renewal payload.
    const current = toCurrentValues(FIELDS, {
      cardholder_name: 'ADA',
      legacy_pin: '9999',
    });

    expect(current).not.toHaveProperty('legacy_pin');
    expect(Object.keys(current).sort()).toEqual(FIELDS.map((f) => f.name).sort());
  });
});

describe('toRenewalValues', () => {
  it('carries every current value forward when there is no extraction', () => {
    const values = toRenewalValues(CURRENT, null);

    expect(values.cardholder_name).toBe('ADA LOVELACE');
    expect(values.number).toBe('4242424242424242');
    expect(values.notes).toBe('Travel card');
  });

  it('never carries the CVV forward', () => {
    expect(toRenewalValues(CURRENT, null)[CVV_FIELD]).toBe('');
    expect(
      toRenewalValues(CURRENT, extraction({ number: '4111111111111111' }))[CVV_FIELD],
    ).toBe('');
  });

  it('overlays extracted values on top of the current card', () => {
    const values = toRenewalValues(
      CURRENT,
      extraction({ number: '4111111111111111', exp_year: '2031' }),
    );

    expect(values.number).toBe('4111111111111111');
    expect(values.exp_year).toBe('2031');
    // Not extracted, so the outgoing card's value stands.
    expect(values.cardholder_name).toBe('ADA LOVELACE');
    expect(values.notes).toBe('Travel card');
  });

  it('keeps the current value when the extraction could not read a field', () => {
    // null means "unreadable", not "the new card has no cardholder".
    const values = toRenewalValues(
      CURRENT,
      extraction({ number: '4111111111111111', cardholder_name: null }),
    );

    expect(values.cardholder_name).toBe('ADA LOVELACE');
  });

  it('ignores extracted fields the type does not declare', () => {
    const values = toRenewalValues(
      { number: '4242424242424242', cvv: '123' },
      extraction({ number: '4111111111111111', issuing_bank: 'Some Bank' }),
    );

    expect(values).not.toHaveProperty('issuing_bank');
  });
});

describe('diffCardFields', () => {
  it('marks only the fields whose value actually moved', () => {
    const proposed = { ...CURRENT, number: '4111111111111111', cvv: '999' };
    const changes = diffCardFields(FIELDS, CURRENT, proposed);
    const byName = Object.fromEntries(changes.map((c) => [c.field.name, c]));

    expect(byName.number.changed).toBe(true);
    expect(byName.number.current).toBe('4242424242424242');
    expect(byName.number.proposed).toBe('4111111111111111');
    expect(byName.cardholder_name.changed).toBe(false);
    expect(byName.exp_year.changed).toBe(false);
  });

  it('treats a typed CVV as a change even though nothing is carried forward', () => {
    const untouched = diffCardFields(FIELDS, CURRENT, toRenewalValues(CURRENT, null));
    expect(untouched.find((c) => c.field.name === CVV_FIELD)?.changed).toBe(false);

    const typed = diffCardFields(FIELDS, CURRENT, { ...CURRENT, cvv: '999' });
    expect(typed.find((c) => c.field.name === CVV_FIELD)?.changed).toBe(true);
  });

  it('ignores whitespace-only differences', () => {
    const changes = diffCardFields(FIELDS, CURRENT, {
      ...CURRENT,
      cardholder_name: '  ADA LOVELACE  ',
    });

    expect(changes.find((c) => c.field.name === 'cardholder_name')?.changed).toBe(false);
  });
});

describe('wasAiAssisted', () => {
  it('is false without an extraction', () => {
    expect(wasAiAssisted(null, { number: '4111111111111111' })).toBe(false);
  });

  it('is true when an extracted value survives into the payload', () => {
    expect(
      wasAiAssisted(extraction({ number: '4111111111111111' }), {
        number: '4111111111111111',
        cardholder_name: 'ADA LOVELACE',
      }),
    ).toBe(true);
  });

  it('is false when every extracted value was overwritten by hand', () => {
    // The audit trail should record what was actually submitted, not that AI
    // happened to be switched on.
    expect(
      wasAiAssisted(extraction({ number: '4111111111111111' }), {
        number: '5555444433332222',
      }),
    ).toBe(false);
  });

  it('is false when the extraction read nothing', () => {
    expect(wasAiAssisted(extraction({}), { number: '4242424242424242' })).toBe(false);
  });
});
