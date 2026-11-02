import '../settings/registry';

import { systemSettingsNamespaceRegistry, userSettingsNamespaceRegistry } from '@marinoscar/platform-api/settings';

import {
  APP_SYSTEM_SETTINGS_NAMESPACES,
  CARD_IMAGE_MAX_BYTES_LIMIT,
  DEFAULT_CARD_IMAGE_MAX_BYTES,
  VAULT_AI_SYSTEM_SETTINGS,
  VAULT_BACKUPS_SYSTEM_SETTINGS,
  VAULT_CARDS_SYSTEM_SETTINGS,
  VAULT_FEATURES_SYSTEM_SETTINGS,
  VAULT_UI_SYSTEM_SETTINGS,
  cardImageMaxBytesFromEnv,
} from './settings';
import { DEFAULT_SYSTEM_SETTINGS } from '../settings/registry/default-system-settings';
import { SettingsProfileImagesAdapter } from '../platform/settings/settings-profile-images.adapter';
import { VaultProfileImages } from '../platform/identity/identity-user.adapters';

describe('Vault settings namespaces', () => {
  it('registers maintenance, storage, then ui, features, ai, vaultCards, vaultBackups (stored key order)', () => {
    expect(systemSettingsNamespaceRegistry.list().map((n) => n.key)).toEqual([
      'maintenance',
      'storage',
      'ui',
      'features',
      'ai',
      'vaultCards',
      'vaultBackups',
    ]);
  });

  it('registers the platform dataTables and navigation user namespaces for the web preference shims', () => {
    expect(userSettingsNamespaceRegistry.list().map((n) => n.key)).toEqual(['dataTables', 'navigation']);
  });

  it('keeps the legacy wire keys of the global row: ui, features, ai', () => {
    expect(Object.keys(DEFAULT_SYSTEM_SETTINGS)).toEqual(
      expect.arrayContaining(['ui', 'features', 'ai', 'vaultCards', 'vaultBackups', 'maintenance']),
    );
    expect(DEFAULT_SYSTEM_SETTINGS).toMatchObject({
      ui: { allowUserThemeOverride: true },
      features: {},
      ai: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', maxCallsPerUserPerDay: 50 },
    });
  });

  it('the ai namespace carries no key: not in its stored, patch, put or default shapes', () => {
    const ns = VAULT_AI_SYSTEM_SETTINGS;
    for (const schema of [ns.storedSchema, ns.patchSchema, ns.putSchema, ns.wirePatchSchema]) {
      expect(Object.keys((schema as unknown as { shape: object }).shape)).not.toContain('apiKey');
    }
    expect(Object.keys(ns.defaults)).not.toContain('apiKey');
    // A PATCH naming apiKey is stripped by the closed body (the interceptor takes it first).
    expect(ns.wirePatchSchema.parse({ model: 'm', apiKey: 'x'.repeat(30) })).toEqual({ model: 'm' });
  });

  it('every default satisfies its stored schema', () => {
    for (const ns of APP_SYSTEM_SETTINGS_NAMESPACES) {
      expect(ns.storedSchema.safeParse(ns.defaults).success).toBe(true);
    }
  });

  describe('merges', () => {
    it('ui merges a partial patch', () => {
      expect(VAULT_UI_SYSTEM_SETTINGS.merge({ allowUserThemeOverride: true }, { allowUserThemeOverride: false })).toEqual({
        allowUserThemeOverride: false,
      });
      expect(VAULT_UI_SYSTEM_SETTINGS.merge({ allowUserThemeOverride: false }, undefined)).toEqual({
        allowUserThemeOverride: false,
      });
    });

    it('features adds and overwrites flags, never drops one', () => {
      expect(VAULT_FEATURES_SYSTEM_SETTINGS.merge({ a: true, b: false }, { b: true, c: true })).toEqual({
        a: true,
        b: true,
        c: true,
      });
    });

    it('features reads a damaged stored value down to its boolean flags', () => {
      const read = VAULT_FEATURES_SYSTEM_SETTINGS.read!;
      expect(read({ a: true, b: 'yes', c: 3 })).toEqual({ a: true });
      expect(read(null)).toEqual({});
      expect(read([true])).toEqual({});
    });

    it('ai keeps the provider openai whatever is patched', () => {
      const merged = VAULT_AI_SYSTEM_SETTINGS.merge(
        { enabled: false, provider: 'openai', model: 'a', maxCallsPerUserPerDay: 1 },
        { enabled: true },
      );
      expect(merged).toEqual({ enabled: true, provider: 'openai', model: 'a', maxCallsPerUserPerDay: 1 });
    });

    it('vaultBackups merges partial content flags', () => {
      const merged = VAULT_BACKUPS_SYSTEM_SETTINGS.merge(VAULT_BACKUPS_SYSTEM_SETTINGS.defaults, { keepCount: 30, includeMedia: true });
      expect(merged).toMatchObject({ keepCount: 30, includeMedia: true, includeSecrets: true });
    });
  });

  describe('vaultCards.imageMaxBytes default (CARD_IMAGE_MAX_BYTES)', () => {
    it('is 5 MB when the variable is unset or blank', () => {
      expect(cardImageMaxBytesFromEnv(undefined)).toBe(DEFAULT_CARD_IMAGE_MAX_BYTES);
      expect(cardImageMaxBytesFromEnv('  ')).toBe(DEFAULT_CARD_IMAGE_MAX_BYTES);
    });

    it('honours a positive integer', () => {
      expect(cardImageMaxBytesFromEnv('1024')).toBe(1024);
    });

    it('ignores an unparseable, non-positive, fractional or absurd value (NaN must not disable the cap)', () => {
      for (const raw of ['5MB', '0', '-1', '1.5', 'abc', String(CARD_IMAGE_MAX_BYTES_LIMIT + 1)]) {
        expect(cardImageMaxBytesFromEnv(raw)).toBe(DEFAULT_CARD_IMAGE_MAX_BYTES);
      }
    });

    it('the registered default is what the environment gave at load', () => {
      expect(VAULT_CARDS_SYSTEM_SETTINGS.defaults.imageMaxBytes).toBe(cardImageMaxBytesFromEnv());
    });

    it('rejects a cap of zero or a negative one', () => {
      expect(VAULT_CARDS_SYSTEM_SETTINGS.wirePatchSchema.safeParse({ imageMaxBytes: 0 }).success).toBe(false);
      expect(VAULT_CARDS_SYSTEM_SETTINGS.wirePatchSchema.safeParse({ imageMaxBytes: -5 }).success).toBe(false);
    });
  });
});

describe('profile image adapters', () => {
  const settingsAdapter = new SettingsProfileImagesAdapter();

  it('normalises a pre-E4.1 profile: useProviderImage false is none, anything else provider', () => {
    expect(settingsAdapter.normalize({ displayName: 'Person A', useProviderImage: false })).toEqual({
      imageSource: 'none',
      imageObjectId: null,
      displayName: 'Person A',
    });
    expect(settingsAdapter.normalize({ useProviderImage: true })).toMatchObject({ imageSource: 'provider' });
    expect(settingsAdapter.normalize(undefined)).toMatchObject({ imageSource: 'provider' });
  });

  it('has no avatar upload: an upload source reads as provider and no object is an avatar', async () => {
    expect(settingsAdapter.normalize({ imageSource: 'upload', imageObjectId: 'x' })).toMatchObject({
      imageSource: 'provider',
      imageObjectId: null,
    });
    await expect(settingsAdapter.isUploadedAvatar()).resolves.toBe(false);
  });

  describe('VaultProfileImages', () => {
    const images = new VaultProfileImages();
    const user = { id: 'u', providerProfileImageUrl: 'https://provider.example.test/p.png' };

    it('uses the provider picture by default and for imageSource provider', () => {
      expect(images.resolveImageUrl(user, undefined)).toBe(user.providerProfileImageUrl);
      expect(images.resolveImageUrl(user, { imageSource: 'provider' })).toBe(user.providerProfileImageUrl);
    });

    it('uses the custom URL when the user opted out of the provider picture (new and legacy shape)', () => {
      const url = 'https://img.example.test/me.png';
      expect(images.resolveImageUrl(user, { imageSource: 'none', customImageUrl: url })).toBe(url);
      expect(images.resolveImageUrl(user, { useProviderImage: false, customImageUrl: url })).toBe(url);
    });

    it('no picture when opted out with no URL', () => {
      expect(images.resolveImageUrl(user, { imageSource: 'none' })).toBeNull();
    });
  });
});
