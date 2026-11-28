import { createHash, randomInt } from 'node:crypto';

import { BROKER_TOKEN_PREFIX, BROKER_TOKEN_RANDOM_LENGTH } from '@marinoscar/vault-contract/broker';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new broker token: `vbk_` plus 40 base62 characters from the CSPRNG (`randomInt` is unbiased).
 * The value is shown once; only {@link hashBrokerToken} of it is stored.
 */
export function generateBrokerToken(): string {
  let random = '';
  for (let i = 0; i < BROKER_TOKEN_RANDOM_LENGTH; i += 1) random += BASE62[randomInt(BASE62.length)];
  return `${BROKER_TOKEN_PREFIX}${random}`;
}

/** The SHA-256 hex of the full token: what `broker_tokens.token_hash` holds. */
export function hashBrokerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
