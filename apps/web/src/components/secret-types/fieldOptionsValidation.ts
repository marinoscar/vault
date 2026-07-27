import type { FieldDefinition } from '../../types';

/**
 * Client-side mirror of the API's `fieldDefinitionSchema`
 * (`apps/api/src/secret-types/dto/create-secret-type.dto.ts`).
 *
 * The server is the authority; this module exists so the builder can never
 * produce a definition the server would reject — an admin should not fill in a
 * whole type definition only to be told about a bad option list by a 400.
 *
 * Server rules encoded here:
 *  - `options` is required and non-empty when `type === 'select'`
 *  - `options` is rejected for every other type
 *  - each option is 1–100 characters
 *  - at most 50 options
 *  - duplicate values are rejected
 *
 * The only place this is deliberately stricter than the server is whitespace:
 * `"   "` satisfies the server's `min(1)` but is a useless choice in a
 * dropdown, so it is treated as blank. Stricter is safe — it can only reject
 * definitions the server would have accepted, never accept ones it refuses.
 */

export const MAX_OPTIONS = 50;
export const MAX_OPTION_LENGTH = 100;

export const OPTION_ERRORS = {
  emptyList: 'Add at least one option',
  blank: 'Option cannot be empty',
  duplicate: 'This option is already in the list',
  tooLong: `Options must be ${MAX_OPTION_LENGTH} characters or less`,
  tooMany: `A field can have at most ${MAX_OPTIONS} options`,
  notAllowed: 'Options are only allowed on Select fields',
} as const;

export interface FieldOptionsValidation {
  /** Per-option message, index-aligned with `field.options` (null = valid). */
  optionErrors: (string | null)[];
  /** Message that applies to the option list as a whole. */
  listError: string | null;
  isValid: boolean;
}

export function validateFieldOptions(field: FieldDefinition): FieldOptionsValidation {
  // Non-select fields must not carry options at all — the API rejects them.
  if (field.type !== 'select') {
    const listError = field.options === undefined ? null : OPTION_ERRORS.notAllowed;
    return { optionErrors: [], listError, isValid: listError === null };
  }

  const options = field.options ?? [];

  const seen = new Set<string>();
  const optionErrors = options.map((option) => {
    if (option.trim().length === 0) return OPTION_ERRORS.blank;
    if (option.length > MAX_OPTION_LENGTH) return OPTION_ERRORS.tooLong;
    if (seen.has(option)) return OPTION_ERRORS.duplicate;
    seen.add(option);
    return null;
  });

  let listError: string | null = null;
  if (options.length === 0) {
    listError = OPTION_ERRORS.emptyList;
  } else if (options.length > MAX_OPTIONS) {
    listError = OPTION_ERRORS.tooMany;
  }

  return {
    optionErrors,
    listError,
    isValid: listError === null && optionErrors.every((e) => e === null),
  };
}

function describeField(field: FieldDefinition, index: number): string {
  return field.label.trim() || field.name.trim() || `Field ${index + 1}`;
}

/**
 * Returns the first options problem across all fields as a human-readable
 * message, or null when every field's options would be accepted by the API.
 * Consumers use this to block save.
 */
export function validateFieldDefinitions(fields: FieldDefinition[]): string | null {
  for (let i = 0; i < fields.length; i++) {
    const { isValid, listError, optionErrors } = validateFieldOptions(fields[i]);
    if (isValid) continue;
    const message = listError ?? optionErrors.find((e) => e !== null) ?? 'Invalid options';
    return `${describeField(fields[i], i)}: ${message}`;
  }
  return null;
}
