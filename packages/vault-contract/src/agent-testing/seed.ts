import { randomBytes } from 'node:crypto';

import { createCanary } from './canary.js';

/**
 * The invented data a conformance target holds: logins (one with a one-time code), a card with a
 * merchant grant and an identity item. Every person, site and value is a placeholder: `Person A`,
 * `*.example.test`, the published test card number `4242424242424242`, random canaries.
 */

/** The page origins the scenarios use. @stability beta */
export const CONFORMANCE_ORIGINS = Object.freeze({
  /** One opened login (with a one-time code) is bound exactly to this origin. */
  exact: 'https://app.example.test',
  /** Same registrable domain as `exact`, no login of its own: lookup returns only `site` matches. */
  siteOnly: 'https://login.example.test',
  /** Two opened logins are bound to this origin. */
  shared: 'https://accounts.example.test',
  /** A different site that looks like `exact`; nothing is bound to it. */
  lookAlike: 'https://app.example.test.lookalike.test',
  /** The merchant of the seeded card's grant. */
  shop: 'https://shop.example.test',
  /** The payment frame the card's grant lists. */
  payFrame: 'https://pay.example.test',
  /** The allowed origin of the seeded identity item. */
  forms: 'https://forms.example.test',
});

/** The seeded logins, by key. @stability beta */
export type ConformanceLoginKey = 'primary' | 'sharedFirst' | 'sharedSecond' | 'closed';

/** One seeded login. `open` is whether its owner opened it to agents. @stability beta */
export interface ConformanceLogin {
  key: ConformanceLoginKey;
  name: string;
  username: string;
  /** A canary. */
  password: string;
  origins: string[];
  /** A random base32 seed (a canary too), or absent. */
  totpSeed?: string;
  open: boolean;
}

/** The seeded card (opened to agents, with one live grant for {@link CONFORMANCE_ORIGINS}.shop). @stability beta */
export interface ConformanceCard {
  name: string;
  /** The published test number `4242424242424242`. */
  number: string;
  holderName: string;
  expMonth: string;
  expYear: string;
  /** A canary. */
  securityCode: string;
  postalCode: string;
  grant: { merchantOrigin: string; frameOrigins: string[]; maxAmount: number; currency: string; includeSecurityCode: boolean };
}

/** The seeded identity item (opened to agents; sensitive fields only on `allowedOrigins`). @stability beta */
export interface ConformanceIdentity {
  name: string;
  values: Record<string, string>;
  allowedOrigins: string[];
}

/** The seeded service key (contract 1.4; opened to agents, read by `service` and `keyName`). @stability beta */
export interface ConformanceServiceKey {
  name: string;
  service: string;
  keyName: string;
  /** A canary. */
  value: string;
}

/** Everything a conformance target seeds. @stability beta */
export interface ConformanceSeed {
  origins: typeof CONFORMANCE_ORIGINS;
  logins: Record<ConformanceLoginKey, ConformanceLogin>;
  card: ConformanceCard;
  identity: ConformanceIdentity;
  /** The service key (contract 1.4). Absent from a seed built before it; the fake then serves none. */
  serviceKey?: ConformanceServiceKey;
  /** Every secret value of the seed, to scan for with `assertNoCanary`. */
  canaries: string[];
}

/** The seed plus the ids the target gave each item. @stability beta */
export interface ConformanceFixture extends ConformanceSeed {
  /** The login ids, plus the card's, the identity item's and the service key's when the target seeded them. */
  ids: Record<ConformanceLoginKey, string> & { card?: string; identity?: string; serviceKey?: string };
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A random base32 TOTP seed of 32 characters (20 bytes). */
function randomTotpSeed(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/**
 * A fresh seed: the same people, sites and shapes every time, new random canaries for the values.
 *
 * @stability beta
 */
export function createConformanceSeed(): ConformanceSeed {
  const o = CONFORMANCE_ORIGINS;
  const login = (
    key: ConformanceLoginKey,
    name: string,
    username: string,
    origins: string[],
    extra: Partial<ConformanceLogin> = {},
  ): ConformanceLogin => ({ key, name, username, password: createCanary(`pw${key}`), origins, open: true, ...extra });
  const logins: Record<ConformanceLoginKey, ConformanceLogin> = {
    primary: login('primary', 'Conformance login A', 'person-a@example.test', [o.exact], { totpSeed: randomTotpSeed() }),
    sharedFirst: login('sharedFirst', 'Conformance login B', 'person-b@example.test', [o.shared]),
    sharedSecond: login('sharedSecond', 'Conformance login C', 'person-c@example.test', [o.shared]),
    closed: login('closed', 'Conformance login D', 'person-d@example.test', [o.exact], { open: false }),
  };
  const card: ConformanceCard = {
    name: 'Conformance card A',
    number: '4242424242424242',
    holderName: 'Person A',
    expMonth: '04',
    expYear: '2031',
    securityCode: createCanary('cvc'),
    postalCode: '00000',
    grant: { merchantOrigin: o.shop, frameOrigins: [o.payFrame], maxAmount: 100, currency: 'USD', includeSecurityCode: true },
  };
  const identity: ConformanceIdentity = {
    name: 'Conformance identity A',
    values: {
      full_name: 'Person A',
      date_of_birth: '1990-01-01',
      id_type: 'Passport',
      id_number: createCanary('idnumber'),
      city: 'Town B',
      country: 'Country C',
      email: 'person-a@example.test',
    },
    allowedOrigins: [o.forms],
  };
  const serviceKey: ConformanceServiceKey = {
    name: 'Conformance service key A',
    service: 'conformance',
    keyName: 'key_a',
    value: createCanary('servicekey'),
  };
  const canaries = [
    ...Object.values(logins).flatMap((l) => [l.password, ...(l.totpSeed ? [l.totpSeed] : [])]),
    card.securityCode,
    identity.values.id_number!,
    serviceKey.value,
  ];
  return { origins: o, logins, card, identity, serviceKey, canaries };
}
