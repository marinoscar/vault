/**
 * Pure helpers for the secrets UI (E10.4, issue #95): form validation that
 * mirrors the API, copy formatting, the version diff and date labels.
 *
 * Nothing here holds a secret value beyond the call that receives it.
 */

import { parseTotpSecret } from '@marinoscar/vault-contract/secrets';
import { isCountryCode } from '@marinoscar/vault-contract/common';
import type { FieldDefinition, KeyValueEntry, SecretType } from '../../core/headless/types.js';
import { CARD_TYPE_NAME } from '../../cards/headless/useCards.js';
import {
  formatCardNumberForCopy,
  formatSecurityCodeForCopy,
  formatExpiryMonthForCopy,
  formatExpiryYearShortForCopy,
} from '../../cards/headless/cardFormat.js';
import {
  cleanKeyValueEntries,
  formatKeyValueEntriesForCopy,
  keyValueEntriesEqual,
  toKeyValueEntries,
} from './keyValue.js';

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
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === '';
}

/** The Credential field that holds the authenticator key. */
export const TOTP_FIELD_NAME = 'totp';

/** Shown under the authenticator-key field when the pasted text is not a usable key. */
export const TOTP_FIELD_HELP =
  "Paste the setup key or the otpauth:// link from the site's QR code setup";

/**
 * Map a failed save to per-field messages. The API answers 400 with
 * `details.errors` entries such as `Field "totp" ...`; the totp one becomes the
 * friendly help text, any other field's message is kept as sent. Empty when the
 * error carries nothing field-specific.
 */
export function fieldErrorsFromApiError(
  err: unknown,
  fields: FieldDefinition[],
): Record<string, string> {
  const raw = (err as { details?: { errors?: unknown } } | null)?.details?.errors;
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const text = typeof entry === 'string' ? entry : '';
    const match = /^Field "([^"]+)"/.exec(text);
    const name = match?.[1];
    if (!name || !fields.some((f) => f.name === name)) continue;
    out[name] = name === TOTP_FIELD_NAME ? TOTP_FIELD_HELP : text;
  }
  return out;
}

/**
 * Validate field values against the type's field definitions, with the same
 * rules `SecretsService.validateDataAgainstType` applies on the server: a
 * required field is non-empty, a number parses, a date is a real date and a
 * select value is one of its options (when options exist). A `country` value
 * is an alpha-3 code of the contract's table. A `keyvalue` value counts as
 * empty without an entry that has a label or a value, and every entry with a
 * value needs a label. Empty optional fields are fine.
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
    if (field.type === 'keyvalue') {
      const entries = cleanKeyValueEntries(value);
      if (entries.length === 0) {
        if (field.required) errors[field.name] = `${field.label} is required`;
      } else if (entries.some((entry) => entry.label === '')) {
        errors[field.name] = `Every ${field.label} entry needs a label`;
      }
      continue;
    }
    if (isBlank(value)) {
      if (field.required) errors[field.name] = `${field.label} is required`;
      continue;
    }
    if (field.name === TOTP_FIELD_NAME && field.sensitive) {
      if (parseTotpSecret(String(value)) === null) errors[field.name] = TOTP_FIELD_HELP;
    } else if (field.format === 'country' && !isCountryCode(String(value).trim().toUpperCase())) {
      errors[field.name] = `${field.label} must be a country code from the list`;
    } else if (field.type === 'number' && Number.isNaN(Number(value))) {
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
 * never carries a field the API would refuse as unknown. `keyvalue` rows are
 * trimmed and a row with neither a label nor a value is dropped (a missing key
 * is derived from the label).
 */
export function cleanSecretData(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === 'keyvalue') {
      const entries = cleanKeyValueEntries(value);
      if (entries.length > 0) out[field.name] = entries;
      continue;
    }
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

/** Digits and the separators a card value may be typed with. */
const CARD_COPY_SHAPE = /^[\d\s./-]*$/;

/**
 * The text a field's copy button puts on the clipboard. A `keyvalue` value
 * (an array of entries) copies as one `Label: value` line per entry; a single
 * entry's own copy button copies just its value.
 */
export function formatSecretValueForCopy(value: unknown, fieldName?: string): string {
  if (Array.isArray(value)) return formatKeyValueEntriesForCopy(value);
  if (typeof value !== 'string') return asText(value);
  const formatter = fieldName ? CARD_COPY_FORMATTERS[fieldName] : undefined;
  // The card formatters keep digits only; a value with letters (a passport's
  // `number`, say) is not a card value and copies as stored.
  if (!formatter || !CARD_COPY_SHAPE.test(value)) return value;
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
  /** `keyvalue` fields only: the inspected version's entries. */
  versionEntries?: KeyValueEntry[];
  /** `keyvalue` fields only: the current version's entries. */
  currentEntries?: KeyValueEntry[];
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return formatKeyValueEntriesForCopy(value);
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Compare a historical version's values with the current ones, field by
 * field, in the type's field order. "added" means the current version has a
 * value the inspected one lacks; "removed" the reverse. `keyvalue` values are
 * compared structurally (entries matched by key, then label, value and the
 * sensitive flag), and carry their entries in `versionEntries` and
 * `currentEntries`; their `version` and `current` texts are the copy text.
 */
export function diffSecretValues(
  fields: FieldDefinition[],
  versionValues: Record<string, unknown>,
  currentValues: Record<string, unknown>,
): FieldDiff[] {
  return fields.map((field) => {
    if (field.type === 'keyvalue') {
      const versionEntries = toKeyValueEntries(versionValues[field.name]);
      const currentEntries = toKeyValueEntries(currentValues[field.name]);
      let change: FieldChange = 'unchanged';
      if (!keyValueEntriesEqual(versionEntries, currentEntries)) {
        if (versionEntries.length === 0) change = 'added';
        else if (currentEntries.length === 0) change = 'removed';
        else change = 'changed';
      }
      return {
        field,
        change,
        version: formatKeyValueEntriesForCopy(versionEntries),
        current: formatKeyValueEntriesForCopy(currentEntries),
        versionEntries,
        currentEntries,
      };
    }
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

/** True for the system `Credential` type, the only one that may be opened to agents. */
export function supportsAgentAccess(type: { name: string; isSystem?: boolean } | null | undefined): boolean {
  return !!type && type.name === 'Credential' && type.isSystem !== false;
}

/** True for the system type `name` (`Card`, `Identity`): the ones with their own agent-access panel (ADR-0003). */
export function isSystemType(type: { name: string; isSystem?: boolean } | null | undefined, name: string): boolean {
  return !!type && type.name === name && type.isSystem !== false;
}

/** A friendly message for a failed agent-access change. */
export function agentAccessErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'AGENT_ACCESS_UNSUPPORTED_TYPE') {
    return 'Only a login, a card or an identity item can be opened to agents.';
  }
  if (code === 'OWNER_SESSION_REQUIRED') {
    return 'Sign in to Vault to change what agents may do with this item.';
  }
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) {
    return 'You cannot change agent access for this secret.';
  }
  return err instanceof Error ? err.message : 'Failed to update agent access';
}
