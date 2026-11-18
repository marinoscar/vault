import { describe, expect, it } from 'vitest';

import { normalizeTotpSecret, parseTotpSecret, toCanonicalOtpauthUri } from '../src/secrets/index.js';
import { SYSTEM_SECRET_TYPES } from '../src/secret-types/index.js';

const SEED = 'JBSWY3DPEHPK3PXP';

describe('parseTotpSecret: accepted', () => {
  it.each([
    ['bare base32', SEED, { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 }],
    ['lowercase with spaces', 'jbsw y3dp ehpk 3pxp', { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 }],
    ['hyphens', 'JBSW-Y3DP-EHPK-3PXP', { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 }],
    ['padding', `${SEED}====`, { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 }],
    [
      'full uri',
      `otpauth://totp/Org%20Alpha:person.a@example.test?secret=${SEED}&issuer=Org%20Alpha&algorithm=sha256&digits=8&period=60`,
      { secret: SEED, algorithm: 'SHA256', digits: 8, period: 60, issuer: 'Org Alpha', account: 'person.a@example.test' },
    ],
    ['uri without label', `otpauth://totp/?secret=${SEED}`, { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 }],
    [
      'issuer from label only',
      `otpauth://totp/Org:acct?secret=${SEED}`,
      { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30, issuer: 'Org', account: 'acct' },
    ],
    [
      'issuer param wins',
      `otpauth://totp/Old:acct?secret=${SEED}&issuer=New`,
      { secret: SEED, algorithm: 'SHA1', digits: 6, period: 30, issuer: 'New', account: 'acct' },
    ],
    ['sha512 digits 7 period 15', `otpauth://totp/a?secret=${SEED}&algorithm=SHA512&digits=7&period=15`, { secret: SEED, algorithm: 'SHA512', digits: 7, period: 15, account: 'a' }],
  ])('%s', (_n, input, expected) => {
    expect(parseTotpSecret(input)).toEqual(expected);
  });
});

describe('parseTotpSecret: rejected', () => {
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['hotp', `otpauth://hotp/a?secret=${SEED}&counter=1`],
    ['other scheme', `https://example.test/?secret=${SEED}`],
    ['no secret', 'otpauth://totp/a?issuer=x'],
    ['invalid base32 chars', 'JBSWY3DPEHPK3P18'],
    ['too short', 'ABCD'],
    ['impossible length', 'ABCDEFGHI'],
    ['bad algorithm', `otpauth://totp/a?secret=${SEED}&algorithm=MD5`],
    ['digits 5', `otpauth://totp/a?secret=${SEED}&digits=5`],
    ['digits 9', `otpauth://totp/a?secret=${SEED}&digits=9`],
    ['digits nan', `otpauth://totp/a?secret=${SEED}&digits=six`],
    ['period 14', `otpauth://totp/a?secret=${SEED}&period=14`],
    ['period 121', `otpauth://totp/a?secret=${SEED}&period=121`],
    ['duplicate secret', `otpauth://totp/a?secret=${SEED}&secret=${SEED}`],
    ['too long', 'A'.repeat(2000)],
  ])('%s', (_n, input) => {
    expect(parseTotpSecret(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseTotpSecret(undefined as unknown as string)).toBeNull();
  });
});

describe('canonical URI', () => {
  it('normalizes a bare secret', () => {
    expect(normalizeTotpSecret('jbsw y3dp ehpk 3pxp')).toBe(
      `otpauth://totp/?secret=${SEED}&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it('round-trips and is idempotent', () => {
    const parsed = parseTotpSecret(
      `otpauth://totp/Org%20Alpha:person.a@example.test?secret=${SEED}&issuer=Org%20Alpha&digits=8`,
    )!;
    const uri = toCanonicalOtpauthUri(parsed);
    expect(uri).toBe(
      `otpauth://totp/Org%20Alpha%3Aperson.a%40example.test?secret=${SEED}&issuer=Org%20Alpha&algorithm=SHA1&digits=8&period=30`,
    );
    expect(parseTotpSecret(uri)).toEqual(parsed);
    expect(normalizeTotpSecret(uri)).toBe(uri);
  });

  it('returns null for invalid input', () => {
    expect(normalizeTotpSecret('nope!')).toBeNull();
  });
});

describe('Credential type', () => {
  it('ends with an optional sensitive totp field', () => {
    const fields = SYSTEM_SECRET_TYPES.find((t) => t.name === 'Credential')!.fields;
    expect(fields[fields.length - 1]).toEqual({
      name: 'totp',
      label: 'Authenticator key (TOTP)',
      type: 'string',
      required: false,
      sensitive: true,
    });
    expect(fields[fields.length - 2]!.name).toBe('additional_urls');
  });
});
