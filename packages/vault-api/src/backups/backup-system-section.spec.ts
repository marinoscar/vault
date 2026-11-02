import {
  toSystemAllowlist,
  toSystemSecretTypes,
  toSystemSettings,
  toSystemUsers,
} from './backup-system-section';

const T = new Date('2026-01-01T00:00:00Z');

describe('system section mappers', () => {
  it('users: explicit fields only, roles sorted, lastLoginAt only when present', () => {
    const rows = [
      {
        id: 'u1',
        email: 'person.a@example.test',
        displayName: 'Person A',
        isActive: true,
        createdAt: T,
        lastLoginAt: T,
        userRoles: [{ role: { name: 'Viewer' } }, { role: { name: 'Admin' } }],
        refreshTokens: [{ tokenHash: 'SECRET-HASH' }],
        profileImageUrl: 'https://img.example.test/x',
      },
    ];
    const [user] = toSystemUsers(rows as never);
    expect(user).toEqual({
      id: 'u1',
      email: 'person.a@example.test',
      displayName: 'Person A',
      isActive: true,
      roles: ['Admin', 'Viewer'],
      createdAt: T.toISOString(),
      lastLoginAt: T.toISOString(),
    });
    expect(toSystemUsers([{ ...rows[0], lastLoginAt: null }] as never)[0]).not.toHaveProperty('lastLoginAt');
  });

  it('allowlist: claimed status and the adder email only', () => {
    const entries = toSystemAllowlist([
      { email: 'a@example.test', notes: 'n', addedAt: T, claimedAt: T, claimedById: 'u1', addedBy: null },
      {
        email: 'b@example.test',
        notes: null,
        addedAt: T,
        claimedAt: null,
        claimedById: null,
        addedBy: { email: 'admin@example.test', id: 'u9' } as never,
      },
    ]);
    expect(entries).toEqual([
      { email: 'a@example.test', notes: 'n', addedBy: null, status: 'claimed', addedAt: T.toISOString(), claimedAt: T.toISOString() },
      { email: 'b@example.test', notes: null, addedBy: 'admin@example.test', status: 'pending', addedAt: T.toISOString(), claimedAt: null },
    ]);
  });

  it('secret types: owner email, no internal flags', () => {
    const [type] = toSystemSecretTypes([
      {
        id: 't1',
        name: 'Custom',
        description: null,
        icon: null,
        fields: [{ name: 'x' }],
        allowAttachments: true,
        createdAt: T,
        updatedAt: T,
        createdBy: { email: 'owner@example.test' },
        isSystem: false,
        createdById: 'u1',
      } as never,
    ]);
    expect(Object.keys(type).sort()).toEqual(
      ['allowAttachments', 'createdAt', 'description', 'fields', 'icon', 'id', 'name', 'owner', 'updatedAt'].sort(),
    );
    expect(type.owner).toBe('owner@example.test');
  });

  it('settings: AI key reduced to apiKeyConfigured, no ciphertext, last4 or key dates', () => {
    const settings = toSystemSettings({
      ui: { allowUserThemeOverride: false },
      features: { a: true },
      ai: {
        enabled: false,
        keyPolicy: 'byok_with_org_fallback',
        providers: { openai: { enabled: true, baseUrl: 'https://proxy.example.test' } },
        cardExtractModel: 'm',
        limits: { perUser: { requestsPerDay: 5 } },
        apiKeyConfigured: true,
        apiKeyLast4: 'ABCD',
        apiKeyUpdatedAt: '2026-01-01T00:00:00.000Z',
        apiKey: { ciphertext: 'CIPHER', iv: 'IV', authTag: 'TAG' },
      },
      updatedAt: T,
      updatedBy: { id: 'u1', email: 'admin@example.test' },
      version: 2,
    });
    expect(settings).toEqual({
      ui: { allowUserThemeOverride: false },
      features: { a: true },
      ai: {
        enabled: false,
        keyPolicy: 'byok_with_org_fallback',
        cardExtractModel: 'm',
        providers: { openai: true },
        perUserRequestsPerMinute: null,
        perUserRequestsPerDay: 5,
        apiKeyConfigured: true,
      },
      updatedAt: T.toISOString(),
      updatedBy: 'admin@example.test',
      version: 2,
    });
    const json = JSON.stringify(settings);
    for (const leaked of ['ABCD', 'CIPHER', 'IV', 'TAG', 'apiKeyLast4', 'apiKeyUpdatedAt', 'proxy.example.test']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('settings without an AI block', () => {
    expect(
      toSystemSettings({ ui: {}, features: {}, ai: null, updatedAt: null, updatedBy: null, version: 1 }).ai,
    ).toBeNull();
  });
});
