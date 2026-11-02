import { describe, expect, it } from 'vitest';

import { VAULT_CONTRACT_PACKAGE } from '../src/index.js';

describe('package root', () => {
  it('exports only the package name', async () => {
    const root = await import('../src/index.js');
    expect(VAULT_CONTRACT_PACKAGE).toBe('@marinoscar/vault-contract');
    expect(Object.keys(root)).toEqual(['VAULT_CONTRACT_PACKAGE']);
  });
});
