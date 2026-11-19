/**
 * Pure helpers for `keyvalue` field values: a list of {@link KeyValueEntry}
 * rows (`key`, `label`, `value`, `sensitive`). Nothing here holds a value
 * beyond the call that receives it.
 */

import type { KeyValueEntry } from '../../core/headless/types.js';

/** Longest entry key the contract accepts (`keyValueEntrySchema`). */
const KEY_MAX = 50;

/** A suggested entry of a `keyvalue` field ("Add: Class"). */
export interface KeyValueSuggestion {
  key: string;
  label: string;
  sensitive: boolean;
}

function isEntryLike(value: unknown): value is Partial<KeyValueEntry> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a stored `keyvalue` value as entries: anything that is not an array
 * is `[]`, and each row's properties are coerced to their wire types.
 */
export function toKeyValueEntries(value: unknown): KeyValueEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEntryLike).map((row) => ({
    key: typeof row.key === 'string' ? row.key : '',
    label: typeof row.label === 'string' ? row.label : '',
    value: row.value === undefined || row.value === null ? '' : String(row.value),
    sensitive: row.sensitive === true,
  }));
}

/**
 * The snake_case base of an entry key for a label: lower case, every run of
 * other characters an underscore, starting with a letter (`entry_` is put in
 * front otherwise), at most 50 characters. '' for a label with no letter or
 * digit.
 */
export function entryKeyBase(label: string): string {
  let key = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (key === '') return '';
  if (!/^[a-z]/.test(key)) key = `entry_${key}`;
  return key.slice(0, KEY_MAX).replace(/_+$/, '');
}

/**
 * The key for a new entry labelled `label`: {@link entryKeyBase}, deduplicated
 * against `taken` with `_2`, `_3`, ... ('' for a label with no letter or
 * digit, so an empty new row has no key yet).
 */
export function deriveEntryKey(label: string, taken: Iterable<string>): string {
  const base = entryKeyBase(label);
  if (base === '') return '';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The entries to save: label and value trimmed, rows with neither dropped,
 * and a missing key derived from the label (unique across the rows).
 */
export function cleanKeyValueEntries(value: unknown): KeyValueEntry[] {
  const rows = toKeyValueEntries(value)
    .map((row) => ({ ...row, key: row.key.trim(), label: row.label.trim(), value: row.value.trim() }))
    .filter((row) => row.label !== '' || row.value !== '');
  const taken = new Set(rows.map((row) => row.key).filter((key) => key !== ''));
  return rows.map((row) => {
    if (row.key !== '') return row;
    const key = deriveEntryKey(row.label, taken);
    taken.add(key);
    return { ...row, key };
  });
}

/**
 * True when two entry lists hold the same entries: matched by key, then the
 * same label, value and sensitive flag. Order does not matter.
 */
export function keyValueEntriesEqual(a: unknown, b: unknown): boolean {
  const left = toKeyValueEntries(a);
  const right = toKeyValueEntries(b);
  if (left.length !== right.length) return false;
  const byKey = new Map(right.map((row) => [row.key, row]));
  if (byKey.size !== right.length) {
    // Duplicate keys cannot be matched by key; compare in order instead.
    return left.every(
      (row, i) =>
        row.key === right[i].key &&
        row.label === right[i].label &&
        row.value === right[i].value &&
        row.sensitive === right[i].sensitive,
    );
  }
  return left.every((row) => {
    const other = byKey.get(row.key);
    return (
      other !== undefined &&
      other.label === row.label &&
      other.value === row.value &&
      other.sensitive === row.sensitive
    );
  });
}

/**
 * The text a whole `keyvalue` field copies: one `Label: value` line per entry
 * with a value, sensitive ones included (copy reads the stored value, as a
 * sensitive field's copy does).
 */
export function formatKeyValueEntriesForCopy(value: unknown): string {
  return toKeyValueEntries(value)
    .filter((row) => row.value !== '')
    .map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}
