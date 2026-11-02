import {
  fieldDefinitionSchema,
  secretTypeFieldsSchema,
  createSecretTypeSchema,
} from './create-secret-type.dto';

describe('fieldDefinitionSchema', () => {
  describe('select fields', () => {
    it('should parse a select field with valid non-empty options', () => {
      const field = {
        name: 'card_network',
        label: 'Card Network',
        type: 'select' as const,
        required: false,
        sensitive: false,
        options: ['Visa', 'Mastercard'],
      };

      const result = fieldDefinitionSchema.safeParse(field);

      expect(result.success).toBe(true);
    });

    it('should fail when options is omitted', () => {
      const field = {
        name: 'card_network',
        label: 'Card Network',
        type: 'select' as const,
        required: false,
        sensitive: false,
      };

      const result = fieldDefinitionSchema.safeParse(field);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['options']);
      }
    });

    it('should fail when options is an empty array', () => {
      const field = {
        name: 'card_network',
        label: 'Card Network',
        type: 'select' as const,
        required: false,
        sensitive: false,
        options: [],
      };

      const result = fieldDefinitionSchema.safeParse(field);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['options']);
      }
    });

    it('should fail when options contains duplicate values', () => {
      const field = {
        name: 'card_network',
        label: 'Card Network',
        type: 'select' as const,
        required: false,
        sensitive: false,
        options: ['Visa', 'Visa'],
      };

      const result = fieldDefinitionSchema.safeParse(field);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['options']);
        expect(result.error.issues[0].message).toMatch(/duplicate/i);
      }
    });
  });

  describe('non-select fields', () => {
    it.each(['string', 'number', 'date'] as const)(
      'should fail when a %s field carries options',
      (type) => {
        const field = {
          name: 'some_field',
          label: 'Some Field',
          type,
          required: false,
          sensitive: false,
          options: ['a', 'b'],
        };

        const result = fieldDefinitionSchema.safeParse(field);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toEqual(['options']);
          expect(result.error.issues[0].message).toMatch(/only allowed for select/i);
        }
      },
    );

    it.each(['string', 'number', 'date'] as const)(
      'should still parse a legacy %s field definition without options (regression)',
      (type) => {
        const field = {
          name: 'some_field',
          label: 'Some Field',
          type,
          required: true,
          sensitive: false,
        };

        const result = fieldDefinitionSchema.safeParse(field);

        expect(result.success).toBe(true);
      },
    );
  });

  it('should fail on an unknown type value', () => {
    const field = {
      name: 'some_field',
      label: 'Some Field',
      type: 'boolean',
      required: false,
      sensitive: false,
    };

    const result = fieldDefinitionSchema.safeParse(field);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['type']);
    }
  });
});

describe('secretTypeFieldsSchema', () => {
  it('should reject duplicate field names', () => {
    const fields = [
      { name: 'username', label: 'Username', type: 'string' as const, required: true, sensitive: false },
      { name: 'username', label: 'Username Again', type: 'string' as const, required: false, sensitive: false },
    ];

    const result = secretTypeFieldsSchema.safeParse(fields);

    expect(result.success).toBe(false);
  });
});

describe('createSecretTypeSchema', () => {
  it('should reject duplicate field names', () => {
    const dto = {
      name: 'Custom Type',
      fields: [
        { name: 'field_a', label: 'Field A', type: 'string' as const, required: true, sensitive: false },
        { name: 'field_a', label: 'Field A Dup', type: 'string' as const, required: false, sensitive: false },
      ],
    };

    const result = createSecretTypeSchema.safeParse(dto);

    expect(result.success).toBe(false);
  });

  it('should accept a valid definition with a select field', () => {
    const dto = {
      name: 'Custom Type',
      fields: [
        {
          name: 'kind',
          label: 'Kind',
          type: 'select' as const,
          required: false,
          sensitive: false,
          options: ['A', 'B'],
        },
      ],
    };

    const result = createSecretTypeSchema.safeParse(dto);

    expect(result.success).toBe(true);
  });
});
