import { randomInt } from 'node:crypto';

import {
  AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH,
  AGENT_GENERATED_PASSWORD_MAX_LENGTH,
  AGENT_GENERATED_PASSWORD_MIN_LENGTH,
} from '@marinoscar/vault-contract/agent';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';

/** Options of {@link generatePassword}. */
export interface GeneratePasswordOptions {
  /** 12 to 128; default 24. */
  length?: number;
  /** Include symbols; default true. */
  symbols?: boolean;
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * A random password from the platform CSPRNG (`crypto.randomInt`, uniform, no modulo bias).
 * It has at least one lower-case letter, one upper-case letter and one digit, and one symbol when
 * `symbols` is on; the characters are shuffled (Fisher-Yates over `randomInt`), so the guaranteed
 * ones do not sit at fixed positions. No ambiguous-character exclusion.
 *
 * @param options - length (12 to 128, default 24) and whether to use symbols (default true).
 * @throws RangeError when the length is out of range.
 * @stability experimental
 */
export function generatePassword(options: GeneratePasswordOptions = {}): string {
  const length = options.length ?? AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH;
  const symbols = options.symbols ?? true;
  if (
    !Number.isInteger(length) ||
    length < AGENT_GENERATED_PASSWORD_MIN_LENGTH ||
    length > AGENT_GENERATED_PASSWORD_MAX_LENGTH
  ) {
    throw new RangeError(
      `Password length must be an integer from ${AGENT_GENERATED_PASSWORD_MIN_LENGTH} to ${AGENT_GENERATED_PASSWORD_MAX_LENGTH}`,
    );
  }
  const classes = symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS];
  const all = classes.join('');
  const chars = classes.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
