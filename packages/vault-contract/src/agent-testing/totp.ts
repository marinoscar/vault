import { createHmac } from 'node:crypto';

import { parseTotpSecret } from '../secrets/totp.js';

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
 * The RFC 6238 code of a seed (base32 or `otpauth://`) at `nowMs`, as Vault computes it. For the
 * fake Vault and for checks; `null` for an invalid seed.
 *
 * @stability beta
 */
export function conformanceTotp(seed: string, nowMs: number = Date.now()): { code: string; expiresAt: string } | null {
  const parsed = parseTotpSecret(seed);
  if (!parsed) return null;
  const periodMs = parsed.period * 1000;
  const counter = Math.floor(nowMs / periodMs);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(parsed.algorithm.toLowerCase(), base32Decode(parsed.secret)).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return {
    code: String(binary % 10 ** parsed.digits).padStart(parsed.digits, '0'),
    expiresAt: new Date((counter + 1) * periodMs).toISOString(),
  };
}
