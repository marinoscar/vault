/**
 * Pure helpers for the secrets UI (E10.4, issue #95): form validation that
 * mirrors the API, copy formatting, the version diff and date labels.
 *
 * Nothing here holds a secret value beyond the call that receives it.
 */

import type { FieldDefinition, SecretType } from '../types';
import { CARD_TYPE_NAME } from '../hooks/useCards';
import {
  formatCardNumberForCopy,
  formatSecurityCodeForCopy,
  formatExpiryMonthForCopy,
  formatExpiryYearShortForCopy,
} from './cardFormat';

/** Bounds of `createSecretSchema` / `updateSecretSchema` in the API. */
export const SECRET_NAME_MAX = 255;
export const SECRET_DESCRIPTION_MAX = 1000;

/** How long a copied secret value may stay on the clipboard (best effort). */
export const SECRET_CLIPBOARD_CLEAR_MS = 30_000;

/** How long a revealed value stays on screen before it is masked again. */
export const SECRET_REVEAL_TIMEOUT_MS = 30_000;

/** True for the system Card type, whose secrets also live in the Cards flows. */
export function isCardType(type: Pick<SecretType, 'isSystem' | 'name'> | null | undefined): boolean {
  return Boolean(type?.isSystem && type.name === CARD_TYPE_NAME);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Validate field values against the type's field definitions, with the same
 * rules `SecretsService.validateDataAgainstType` applies on the server: a
 * required field is non-empty, a number parses, a date is a real date and a
 * select value is one of its options (when options exist). Empty optional
 * fields are fine.
 *
 * @returns field name to message; empty when valid.
 */
export function validateSecretFields(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = data[field.name];
    if (isBlank(value)) {
      if (field.required) errors[field.name] = `${field.label} is required`;
      continue;
    }
    if (field.type === 'number' && Number.isNaN(Number(value))) {
      errors[field.name] = `${field.label} must be a number`;
    } else if (field.type === 'date' && Number.isNaN(new Date(String(value)).getTime())) {
      errors[field.name] = `${field.label} must be a valid date`;
    } else if (field.type === 'select') {
      const options = Array.isArray(field.options) ? field.options : [];
      if (options.length > 0 && !options.includes(String(value))) {
        errors[field.name] = `${field.label} must be one of: ${options.join(', ')}`;
      }
    }
  }
  return errors;
}

export interface SecretFormErrors {
  name?: string;
  description?: string;
  typeId?: string;
  fields: Record<string, string>;
}

/** Validate the whole create/edit form; `hasErrors` tells whether to submit. */
export function validateSecretForm(input: {
  name: string;
  description: string;
  typeId?: string;
  requireType?: boolean;
  fields: FieldDefinition[];
  data: Record<string, unknown>;
}): { errors: SecretFormErrors; hasErrors: boolean } {
  const errors: SecretFormErrors = { fields: validateSecretFields(input.fields, input.data) };
  const name = input.name.trim();
  if (name === '') errors.name = 'Name is required';
  else if (name.length > SECRET_NAME_MAX) errors.name = `Name must be at most ${SECRET_NAME_MAX} characters`;
  if (input.description.trim().length > SECRET_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${SECRET_DESCRIPTION_MAX} characters`;
  }
  if (input.requireType && !input.typeId) errors.typeId = 'Type is required';
  const hasErrors =
    Boolean(errors.name || errors.description || errors.typeId) ||
    Object.keys(errors.fields).length > 0;
  return { errors, hasErrors };
}

/**
 * Drop keys the type does not declare and empty optional values, so the body
 * never carries a field the API would refuse as unknown.
 */
export function cleanSecretData(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data[field.name];
    if (!isBlank(value)) out[field.name] = value;
  }
  return out;
}

/** Card fields reformatted on copy so they paste cleanly into a checkout form. */
const CARD_COPY_FORMATTERS: Record<string, (value: unknown) => string> = {
  number: formatCardNumberForCopy,
  cvv: formatSecurityCodeForCopy,
  security_code_2: formatSecurityCodeForCopy,
  exp_month: formatExpiryMonthForCopy,
  exp_year: formatExpiryYearShortForCopy,
};

/** The text a field's copy button puts on the clipboard. */
export function formatSecretValueForCopy(value: string, fieldName?: string): string {
  const formatter = fieldName ? CARD_COPY_FORMATTERS[fieldName] : undefined;
  if (!formatter) return value;
  const formatted = formatter(value);
  // Formatters return '' for values they cannot parse; the stored value is
  // more useful than nothing.
  return formatted === '' ? value : formatted;
}

export type FieldChange = 'unchanged' | 'changed' | 'added' | 'removed';

export interface FieldDiff {
  field: FieldDefinition;
  change: FieldChange;
  /** The value in the version being inspected ('' when absent). */
  version: string;
  /** The value in the current version ('' when absent). */
  current: string;
}

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Compare a historical version's values with the current ones, field by
 * field, in the type's field order. "added" means the current version has a
 * value the inspected one lacks; "removed" the reverse.
 */
export function diffSecretValues(
  fields: FieldDefinition[],
  versionValues: Record<string, unknown>,
  currentValues: Record<string, unknown>,
): FieldDiff[] {
  return fields.map((field) => {
    const version = asText(versionValues[field.name]);
    const current = asText(currentValues[field.name]);
    let change: FieldChange = 'unchanged';
    if (version !== current) {
      if (version === '') change = 'added';
      else if (current === '') change = 'removed';
      else change = 'changed';
    }
    return { field, change, version, current };
  });
}

/** "just now", "5m ago", "3h ago", "2d ago", then a locale date past 30 days. */
export function formatRelativeTime(dateString: string, now: Date = new Date()): string {
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return date.toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
