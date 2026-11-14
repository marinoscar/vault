// =============================================================================
// The "Access token" TUI screen's logic, kept free of ink so it is testable
// =============================================================================

import {
  TOKEN_PRESETS,
  describeExpiry,
  formatDate,
  formatDuration,
  parseDurationText,
  type ExpiryLevel,
  type LocalTokenState,
  type PatListItem,
  type TokenDuration,
} from '../lib/tokens.js';

export const CUSTOM_CHOICE = 'custom';
export const BACK_CHOICE = 'back';

export interface ChoiceItem {
  key: string;
  label: string;
  value: string;
}

/** The lifetime menu: the presets, Custom, Back. */
export function durationChoices(): ChoiceItem[] {
  return [
    ...TOKEN_PRESETS.map((p) => ({ key: p.label, label: p.label, value: `${p.duration}:${p.unit}` })),
    { key: CUSTOM_CHOICE, label: 'Custom…', value: CUSTOM_CHOICE },
    { key: BACK_CHOICE, label: 'Back', value: BACK_CHOICE },
  ];
}

/** A preset value (`12:months`) as a duration; undefined for Custom / Back / garbage. */
export function presetFromValue(value: string): TokenDuration | undefined {
  const preset = TOKEN_PRESETS.find((p) => `${p.duration}:${p.unit}` === value);
  return preset ? { duration: preset.duration, unit: preset.unit } : undefined;
}

/** The custom-lifetime field: a duration, or the message to show. */
export function parseCustomInput(text: string): { ok: true; value: TokenDuration } | { ok: false; error: string } {
  try {
    return { ok: true, value: parseDurationText(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function inkColorFor(level: ExpiryLevel): string {
  switch (level) {
    case 'ok':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'expired':
      return 'red';
    default:
      return 'gray';
  }
}

export interface FieldRow {
  label: string;
  value: string;
  color?: string;
  dim?: boolean;
}

/**
 * The rows describing the current token. `current` is the server's row when it
 * was identified; otherwise the expiry the config file recorded is used.
 */
export function currentTokenRows(local: LocalTokenState, current: PatListItem | undefined, now: Date = new Date()): FieldRow[] {
  const rows: FieldRow[] = [{ label: 'Server', value: local.serverUrl }];
  if (local.source === undefined) {
    rows.push({ label: 'Token', value: 'none (not signed in)', color: 'red' });
    return rows;
  }
  const source = local.source === 'environment' ? '  (from the environment)' : local.source === 'legacy' ? '  (from vaultcli auth.json)' : '';
  rows.push({ label: 'Token', value: `${current ? `${current.tokenPrefix}…` : local.hint}${source}` });
  const name = current?.name ?? local.tokenName;
  if (name) rows.push({ label: 'Name', value: name });
  const expiresAt = current?.expiresAt ?? local.expiresAt;
  const exp = describeExpiry(expiresAt, now);
  rows.push({
    label: 'Expires',
    value: exp.level === 'unknown' ? 'unknown' : `${formatDate(expiresAt)}  (${exp.text})`,
    color: inkColorFor(exp.level),
  });
  if (current?.lastUsedAt) rows.push({ label: 'Last used', value: formatDate(current.lastUsedAt), dim: true });
  return rows;
}

/** A one-line nudge under the rows, or undefined when the token is fine. */
export function expiryAdvice(local: LocalTokenState, current: PatListItem | undefined, now: Date = new Date()): string | undefined {
  if (local.source === undefined) return 'Sign in first: choose Login from the menu.';
  const level = describeExpiry(current?.expiresAt ?? local.expiresAt, now).level;
  if (level === 'expired') return 'This token has expired: choose Login from the menu to sign in again.';
  if (level === 'warning') return 'This token expires soon. Create a longer-lived replacement so scheduled backups keep working.';
  return undefined;
}

/** Revoking the old token is offered only when it is known and is not the one an env var keeps sending. */
export function canOfferRevoke(local: LocalTokenState, previous: PatListItem | undefined, newId: string): boolean {
  return previous !== undefined && previous.id !== newId && local.source !== 'environment';
}

export function describeChoice(d: TokenDuration): string {
  return formatDuration(d);
}
