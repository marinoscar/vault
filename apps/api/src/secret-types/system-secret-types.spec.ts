import { SYSTEM_SECRET_TYPES } from '../../prisma/system-secret-types';
import { CARD_NETWORKS, CARD_KINDS } from '../common/constants/card.constants';
import { createSecretTypeSchema } from './dto/create-secret-type.dto';

// =============================================================================
// System Secret Type regression guards
// =============================================================================
// This is the ONLY mechanism CI has to protect the system secret types: CI has
// no database and never runs prisma/seed.ts. These assertions must catch a
// malformed or destructively-edited SYSTEM_SECRET_TYPES entry at build time.

function findType(name: string) {
  const type = SYSTEM_SECRET_TYPES.find((t) => t.name === name);
  if (!type) {
    throw new Error(`Expected system secret type "${name}" to exist`);
  }
  return type;
}

function findField(typeName: string, fieldName: string) {
  const type = findType(typeName);
  const field = type.fields.find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(`Expected field "${fieldName}" on type "${typeName}" to exist`);
  }
  return field;
}

describe('SYSTEM_SECRET_TYPES', () => {
  describe('Card type', () => {
    it('should allow attachments', () => {
      const card = findType('Card');
      expect(card.allowAttachments).toBe(true);
    });

    it('should contain card_network, card_kind, security_code_2, and issuing_bank', () => {
      const card = findType('Card');
      const names = card.fields.map((f) => f.name);

      expect(names).toEqual(
        expect.arrayContaining([
          'card_network',
          'card_kind',
          'security_code_2',
          'issuing_bank',
        ]),
      );
    });

    it('card_network.options should deep-equal CARD_NETWORKS', () => {
      const field = findField('Card', 'card_network');
      expect(field.options).toEqual(CARD_NETWORKS);
    });

    it('card_kind.options should deep-equal CARD_KINDS', () => {
      const field = findField('Card', 'card_kind');
      expect(field.options).toEqual(CARD_KINDS);
    });

    it('card_network should be required: false', () => {
      // A required field would make every pre-existing card secret
      // permanently unsaveable (it has no value for a field that didn't
      // exist when it was created).
      const field = findField('Card', 'card_network');
      expect(field.required).toBe(false);
    });

    it('card_kind should be required: false', () => {
      const field = findField('Card', 'card_kind');
      expect(field.required).toBe(false);
    });

    it('cvv should remain required: true and sensitive: true', () => {
      const field = findField('Card', 'cvv');
      expect(field.required).toBe(true);
      expect(field.sensitive).toBe(true);
    });

    it('security_code_2 should be sensitive: true', () => {
      const field = findField('Card', 'security_code_2');
      expect(field.sensitive).toBe(true);
    });
  });

  describe('schema validity', () => {
    it.each(SYSTEM_SECRET_TYPES.map((t) => [t.name, t] as const))(
      '%s should pass createSecretTypeSchema',
      (_name, type) => {
        const result = createSecretTypeSchema.safeParse(type);

        if (!result.success) {
          // Surface the Zod issues directly in the failure message so a
          // malformed field definition is easy to diagnose.
          throw new Error(
            `${type.name} failed createSecretTypeSchema: ${JSON.stringify(result.error.issues, null, 2)}`,
          );
        }

        expect(result.success).toBe(true);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Append-only guard
  // ---------------------------------------------------------------------------
  // `validateDataAgainstType` (secrets.service.ts) rejects any data key that
  // isn't a known field on the type. If a field is ever removed or renamed
  // here, every existing secret of that type that still has a value stored
  // under the old field name becomes permanently unsaveable on its next edit
  // (the stored data would fail validation against the new field set).
  //
  // This frozen map is a snapshot of the fields each system type must keep,
  // at minimum. Fields may only be ADDED to SYSTEM_SECRET_TYPES going
  // forward — never removed or renamed. If this test fails, you likely
  // removed/renamed a field; add a new field instead and leave the old one
  // in place (or handle migration explicitly, which this test intentionally
  // makes hard to do by accident).
  const EXPECTED_FIELDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = Object.freeze({
    Credential: ['username', 'password', 'url', 'notes'],
    'API Key': ['key', 'provider', 'notes'],
    Card: [
      'card_network',
      'card_kind',
      'cardholder_name',
      'number',
      'exp_month',
      'exp_year',
      'cvv',
      'security_code_2',
      'issuing_bank',
      'notes',
    ],
    Token: ['token', 'provider', 'notes'],
    Note: ['content'],
    Document: ['title', 'notes'],
  });

  describe('append-only field guard', () => {
    it.each(Object.entries(EXPECTED_FIELDS_BY_TYPE))(
      '%s should retain all previously-shipped fields',
      (typeName, expectedFields) => {
        const type = findType(typeName);
        const currentFieldNames = type.fields.map((f) => f.name);

        for (const expectedField of expectedFields) {
          expect(currentFieldNames).toContain(expectedField);
        }
      },
    );
  });
});
