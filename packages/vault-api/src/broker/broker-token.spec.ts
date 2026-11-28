import { isBrokerTokenShape } from '@marinoscar/vault-contract/broker';

import { generateBrokerToken, hashBrokerToken } from './broker-token';

describe('broker token', () => {
  it('is vbk_ plus 40 base62 characters, different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateBrokerToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(isBrokerTokenShape(token)).toBe(true);
      expect(token).toMatch(/^vbk_[A-Za-z0-9]{40}$/);
    }
  });

  it('hashes to the SHA-256 hex of the whole token', () => {
    expect(hashBrokerToken('vbk_abc')).toBe('d7ebe433fdbac6c65278b48cc80377ffae70c86b53e3543c4e7fbe49c0661182');
    expect(hashBrokerToken('vbk_abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBrokerToken('vbk_abc')).toBe(hashBrokerToken('vbk_abc'));
    expect(hashBrokerToken('vbk_abc')).not.toBe(hashBrokerToken('vbk_abd'));
  });
});
