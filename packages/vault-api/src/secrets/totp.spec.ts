import { parseTotpSecret, type ParsedTotp } from '@marinoscar/vault-contract/secrets';

import { generateTotp } from './totp';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Test-only encoder for the RFC 6238 Appendix B ASCII seeds (standard published vectors). */
function base32Encode(ascii: string): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of Buffer.from(ascii, 'ascii')) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

const SEEDS = {
  SHA1: '12345678901234567890',
  SHA256: '12345678901234567890123456789012',
  SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
} as const;

// [unix seconds, SHA1, SHA256, SHA512]: RFC 6238 Appendix B.
const VECTORS: Array<[number, string, string, string]> = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

const parsedFor = (algorithm: keyof typeof SEEDS, digits: 6 | 7 | 8 = 8): ParsedTotp => ({
  secret: base32Encode(SEEDS[algorithm]),
  algorithm,
  digits,
  period: 30,
});

describe('generateTotp (RFC 6238 Appendix B)', () => {
  it.each(VECTORS)('t=%i', (t, sha1, sha256, sha512) => {
    expect(generateTotp(parsedFor('SHA1'), t * 1000).code).toBe(sha1);
    expect(generateTotp(parsedFor('SHA256'), t * 1000).code).toBe(sha256);
    expect(generateTotp(parsedFor('SHA512'), t * 1000).code).toBe(sha512);
  });

  it('works end to end through the contract parser', () => {
    const parsed = parseTotpSecret(
      `otpauth://totp/Org%20Alpha:a?secret=${base32Encode(SEEDS.SHA1)}&digits=8`,
    )!;
    expect(generateTotp(parsed, 59_000).code).toBe('94287082');
  });

  it('truncates to 6 digits and keeps leading zeros', () => {
    // 07081804 at 8 digits is 081804 at 6 (same dynamic truncation, mod 10^6).
    expect(generateTotp(parsedFor('SHA1', 6), 1111111109 * 1000).code).toBe('081804');
  });

  it('reports the end of the time step and the period', () => {
    const r = generateTotp(parsedFor('SHA1', 6), 59_000);
    expect(r.expiresAt).toBe(new Date(60_000).toISOString());
    expect(r.period).toBe(30);
    const edge = generateTotp(parsedFor('SHA1', 6), 60_000);
    expect(edge.expiresAt).toBe(new Date(90_000).toISOString());
  });

  it('honours a custom period', () => {
    const r = generateTotp({ ...parsedFor('SHA1', 6), period: 60 }, 61_000);
    expect(r.expiresAt).toBe(new Date(120_000).toISOString());
    expect(r.period).toBe(60);
  });
});
