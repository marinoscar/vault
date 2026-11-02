// =============================================================================
// Vault's settings namespaces (issue #79, E4.1, epic #54)
// =============================================================================
//
// What Vault adds to the platform's settings registries. Namespace keys are
// camelCase (`SETTINGS_NAMESPACE_KEY_PATTERN`), so the brief's `vault.cards` is
// `vaultCards`.
//
//   system (stored key order, append only):
//     ui, features, ai      the three blocks of the `global` row Vault has always
//                           stored. SAME KEYS, SAME SHAPES: no stored value moves
//                           and `GET /api/system-settings` keeps its wire shape.
//     vaultCards            card image size cap, expiry warning window
//     vaultBackups          defaults for the admin backup schedule
//   user:
//     dataTables, navigation (the platform's); profile extension `customImageUrl`
//
// `ai` is NOT added to the `SystemSettingsNamespaces` augmentation: the platform AI
// slice (E8) already types that key with its own policy. Vault reads its block
// by declaration, `getNamespace(VAULT_AI_SYSTEM_SETTINGS)`.
//
// `ai` carries no key material: the platform registry refuses a secret-named
// field, and the OpenAI key lives in the credential store (E4.2). The masked
// projection (`apiKeyConfigured`, `apiKeyLast4`, `apiKeyUpdatedAt`) and the
// write-only `ai.apiKey` of a PATCH are handled by `AiKeyProjectionInterceptor`
// (`platform/settings/`). Until E8 this is Vault's own `ai` declaration; E8
// replaces it with the platform AI slice's, extended with these fields.
// =============================================================================

import { z } from 'zod';
import {
  extendUserProfile,
  type SystemSettingsNamespace,
  type UserSettingsNamespace,
} from '@marinoscar/platform-api/settings';

import { TELEMETRY_SYSTEM_SETTINGS } from '../platform/telemetry/telemetry.system-settings';

// -----------------------------------------------------------------------------
// ui
// -----------------------------------------------------------------------------

const uiSchema = z.object({ allowUserThemeOverride: z.boolean() });
export type VaultUiSettings = z.infer<typeof uiSchema>;

export const VAULT_UI_SYSTEM_SETTINGS = {
  key: 'ui',
  description: 'Interface policy: whether users may override the theme.',
  storedSchema: uiSchema,
  patchSchema: uiSchema.partial(),
  putSchema: uiSchema,
  wirePatchSchema: uiSchema.partial(),
  responseSchema: uiSchema,
  defaults: { allowUserThemeOverride: true },
  requiredOnPut: true,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
} satisfies SystemSettingsNamespace<'ui', VaultUiSettings, Partial<VaultUiSettings>>;

// -----------------------------------------------------------------------------
// features
// -----------------------------------------------------------------------------

const featuresSchema = z.record(z.string(), z.boolean());
export type VaultFeatureFlags = z.infer<typeof featuresSchema>;

export const VAULT_FEATURES_SYSTEM_SETTINGS = {
  key: 'features',
  description: 'Feature flags: a free map of flag name to on/off.',
  storedSchema: featuresSchema,
  patchSchema: featuresSchema,
  putSchema: featuresSchema,
  wirePatchSchema: featuresSchema,
  responseSchema: featuresSchema,
  defaults: {},
  requiredOnPut: true,
  // A flag value that is not a boolean cannot be stored; drop it, keep the rest.
  read: (stored) => {
    const source =
      stored !== null && typeof stored === 'object' && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(source).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    );
  },
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
} satisfies SystemSettingsNamespace<'features', VaultFeatureFlags, VaultFeatureFlags>;

// -----------------------------------------------------------------------------
// ai (non-secret block; the key is a credential)
// -----------------------------------------------------------------------------

const aiStoredSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('openai'),
  model: z.string().min(1).max(100),
  maxCallsPerUserPerDay: z.number().int().min(0).max(10000),
});
const aiPatchSchema = z.object({
  enabled: aiStoredSchema.shape.enabled.optional(),
  model: aiStoredSchema.shape.model.optional(),
  maxCallsPerUserPerDay: aiStoredSchema.shape.maxCallsPerUserPerDay.optional(),
});
// The response documents the masked projection `AiKeyProjectionInterceptor` adds.
const aiResponseSchema = aiStoredSchema.extend({
  apiKeyConfigured: z.boolean(),
  apiKeyLast4: z.string().nullable(),
  apiKeyUpdatedAt: z.string().nullable(),
});
export type VaultAiSettings = z.infer<typeof aiStoredSchema>;

export const DEFAULT_VAULT_AI_SETTINGS: VaultAiSettings = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxCallsPerUserPerDay: 50,
};

export const VAULT_AI_SYSTEM_SETTINGS = {
  key: 'ai',
  description:
    'Card-import AI: opt-in switch, model and per-user daily budget. The provider key is a credential, never part of this block.',
  storedSchema: aiStoredSchema,
  patchSchema: aiPatchSchema,
  // A PUT that carries `ai` replaces the non-secret block whole (the key is not part of it).
  putSchema: aiStoredSchema,
  wirePatchSchema: aiPatchSchema,
  responseSchema: aiResponseSchema,
  defaults: DEFAULT_VAULT_AI_SETTINGS,
  // A PUT never carries `ai`: the stored block is kept (as it always was).
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}), provider: 'openai' as const }),
} satisfies SystemSettingsNamespace<'ai', VaultAiSettings, z.infer<typeof aiPatchSchema>>;

// -----------------------------------------------------------------------------
// vaultCards
// -----------------------------------------------------------------------------

/** The cap when neither the setting nor `CARD_IMAGE_MAX_BYTES` says otherwise: 5 MB. */
export const DEFAULT_CARD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CARD_IMAGE_MAX_BYTES_LIMIT = 1024 * 1024 * 1024;

/**
 * `CARD_IMAGE_MAX_BYTES` as the DEFAULT of `vaultCards.imageMaxBytes`. A
 * non-numeric, non-positive or absurd value is ignored (a typo'd `5MB` must not
 * parse to NaN and disable the check).
 */
export function cardImageMaxBytesFromEnv(raw: string | undefined = process.env.CARD_IMAGE_MAX_BYTES): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_CARD_IMAGE_MAX_BYTES;
  const parsed = /^\d+$/.test(raw.trim()) ? parseInt(raw.trim(), 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= CARD_IMAGE_MAX_BYTES_LIMIT
    ? parsed
    : DEFAULT_CARD_IMAGE_MAX_BYTES;
}

const cardsSchema = z.object({
  imageMaxBytes: z.number().int().min(1).max(CARD_IMAGE_MAX_BYTES_LIMIT),
  expiryWarningDays: z.number().int().min(0).max(365),
});
export type VaultCardsSettings = z.infer<typeof cardsSchema>;

export const VAULT_CARDS_SYSTEM_SETTINGS = {
  key: 'vaultCards',
  description: 'Payment-card secrets: the largest card face image accepted, and how early an expiry is flagged.',
  storedSchema: cardsSchema,
  patchSchema: cardsSchema.partial(),
  putSchema: cardsSchema.partial(),
  wirePatchSchema: cardsSchema.partial(),
  responseSchema: cardsSchema,
  defaults: { imageMaxBytes: cardImageMaxBytesFromEnv(), expiryWarningDays: 30 },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
} satisfies SystemSettingsNamespace<'vaultCards', VaultCardsSettings, Partial<VaultCardsSettings>>;

// -----------------------------------------------------------------------------
// vaultBackups
// -----------------------------------------------------------------------------

const backupsSchema = z.object({
  keepCount: z.number().int().min(1).max(365),
  includeAttachments: z.boolean(),
  includeVersions: z.boolean(),
  includeSecrets: z.boolean(),
  includeMedia: z.boolean(),
  includeSystem: z.boolean(),
});
export type VaultBackupsSettings = z.infer<typeof backupsSchema>;

export const VAULT_BACKUPS_SYSTEM_SETTINGS = {
  key: 'vaultBackups',
  description:
    'Defaults the admin backup schedule starts from until a schedule is saved: how many to keep and what an archive contains.',
  storedSchema: backupsSchema,
  patchSchema: backupsSchema.partial(),
  putSchema: backupsSchema.partial(),
  wirePatchSchema: backupsSchema.partial(),
  responseSchema: backupsSchema,
  defaults: {
    keepCount: 7,
    includeAttachments: true,
    includeVersions: false,
    includeSecrets: true,
    includeMedia: false,
    includeSystem: false,
  },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
} satisfies SystemSettingsNamespace<'vaultBackups', VaultBackupsSettings, Partial<VaultBackupsSettings>>;

/** Vault's system namespaces, in stored key order (after the platform's). */
export const APP_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [
  VAULT_UI_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_FEATURES_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_AI_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_CARDS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_BACKUPS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The platform telemetry slice's policy (E9.2, #90): off and inert by default.
  TELEMETRY_SYSTEM_SETTINGS as SystemSettingsNamespace,
];

/** Vault's own user namespaces (none; `dataTables` and `navigation` are the platform's). */
export const APP_USER_SETTINGS_NAMESPACES: readonly UserSettingsNamespace[] = [];

/**
 * `profile.customImageUrl`: Vault lets a user point their picture at a URL (the
 * platform offers upload instead). Kept as a bounded, optional profile field so
 * no stored value is dropped; `VaultProfileImages` honours it.
 */
extendUserProfile({
  fields: z.object({
    customImageUrl: z.url().max(2048).optional(),
  }),
});

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    ui: VaultUiSettings;
    features: VaultFeatureFlags;
    vaultCards: VaultCardsSettings;
    vaultBackups: VaultBackupsSettings;
  }

  interface UserProfileSettingsExtensions {
    customImageUrl?: string;
  }
}
