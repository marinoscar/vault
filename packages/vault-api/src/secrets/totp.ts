import { createHmac } from 'node:crypto';

import type { ParsedTotp } from '@marinoscar/vault-contract/secrets';

/**
 * RFC 6238 TOTP code generation (HMAC-based, via `node:crypto`). Pure: the caller passes the
 * clock. Parsing and validation of the seed live in `@marinoscar/vault-contract/secrets`.
 *
 * @packageDocumentation
 */

/** A generated one-time code. @stability experimental */
export interface TotpCode {
  /** Zero-padded decimal code of `digits` characters. */
  code: string;
  /** ISO 8601 instant the code stops being valid (the end of its time step). */
  expiresAt: string;
  /** The step length in seconds. */
  period: number;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * The TOTP code of `parsed` at `nowMs` (milliseconds since the epoch), per RFC 6238 with T0 = 0.
 *
 * @stability experimental
 */
export function generateTotp(parsed: ParsedTotp, nowMs: number): TotpCode {
  const periodMs = parsed.period * 1000;
  const counter = Math.floor(nowMs / periodMs);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(parsed.algorithm.toLowerCase(), base32Decode(parsed.secret))
    .update(message)
    .digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  const code = String(binary % 10 ** parsed.digits).padStart(parsed.digits, '0');
  return {
    code,
    expiresAt: new Date((counter + 1) * periodMs).toISOString(),
    period: parsed.period,
  };
}
