// =============================================================================
// Vault's settings namespaces (issue #79, E4.1, epic #54)
// =============================================================================
//
// What Vault adds to the platform's settings registries. Namespace keys are
// camelCase (`SETTINGS_NAMESPACE_KEY_PATTERN`), so the brief's `vault.cards` is
// `vaultCards`.
//
//   system (stored key order, append only):
//     ui, features          the two blocks of the `global` row Vault has always
//                           stored. SAME KEYS, SAME SHAPES.
//     ai                    the PLATFORM AI slice's policy (E8.1, issue #87), extended
//                           with `cardExtractModel`. The old `{ enabled, provider, model,
//                           maxCallsPerUserPerDay }` block is rewritten into it by
//                           `npm run vault:migrate-ai-platform` (docs/runbooks/ai-platform-migration.md).
//     vaultCards            card image size cap, expiry warning window
//     vaultBackups          defaults for the admin backup schedule
//     agentAccess           the agent API's kill switch (default off) and per-minute limits (E14.6);
//                           `cards` and `identity` blocks: their own switches (default off) and limits (ADR-0003)
//   user:
//     dataTables, navigation (the platform's); profile extension `customImageUrl`
//
// =============================================================================

import { z } from 'zod';
import {
  AGENT_ACCESS_SETTINGS_DEFAULTS,
  agentAccessSettingsSchema,
  agentBrokerSettingsSchema,
  agentCardAccessSettingsSchema,
  agentIdentityAccessSettingsSchema,
  resolveAgentAccessSettings,
  type AgentAccessSettings,
} from '@marinoscar/vault-contract/agent';
import { AI_SYSTEM_SETTINGS } from '@marinoscar/platform-api/ai';
import {
  extendUserProfile,
  type SystemSettingsNamespace,
  type SystemSettingsNamespaceExtension,
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

// -----------------------------------------------------------------------------
// agentAccess
// -----------------------------------------------------------------------------

/**
 * A patch of `agentAccess`: every field optional, the `cards` and `identity` blocks too, so an
 * admin can flip `cards.enabled` alone. Merged field by field into the current value.
 */
export const agentAccessSettingsPatchSchema = agentAccessSettingsSchema
  .extend({
    cards: agentCardAccessSettingsSchema.partial(),
    identity: agentIdentityAccessSettingsSchema.partial(),
    // The credential broker block (#246) is patched field by field too.
    broker: agentBrokerSettingsSchema.partial(),
  })
  .partial();
export type AgentAccessSettingsPatch = z.infer<typeof agentAccessSettingsPatchSchema>;

export const VAULT_AGENT_ACCESS_SYSTEM_SETTINGS = {
  key: 'agentAccess',
  description:
    'The agent credential API (/api/agent/v1): the deployment kill switch (off by default), the per-minute limits of lookup, fill, totp and write calls, and the card and identity release switches (both off by default) with their own limits (ADR-0003), and the credential broker block `broker` (off by default, forwards per minute, size and time caps; ADR-0006).',
  storedSchema: agentAccessSettingsSchema,
  patchSchema: agentAccessSettingsPatchSchema,
  putSchema: agentAccessSettingsPatchSchema,
  wirePatchSchema: agentAccessSettingsPatchSchema,
  responseSchema: agentAccessSettingsSchema,
  defaults: resolveAgentAccessSettings(AGENT_ACCESS_SETTINGS_DEFAULTS),
  requiredOnPut: false,
  // A row stored before ADR-0003 has no `cards` or `identity`: both resolve off.
  read: (stored) => resolveAgentAccessSettings(stored),
  merge: (current, patch) =>
    resolveAgentAccessSettings({
      ...current,
      ...(patch ?? {}),
      cards: { ...current.cards, ...(patch?.cards ?? {}) },
      identity: { ...current.identity, ...(patch?.identity ?? {}) },
      broker: { ...current.broker, ...(patch?.broker ?? {}) },
    }),
} satisfies SystemSettingsNamespace<'agentAccess', AgentAccessSettings, AgentAccessSettingsPatch>;

/** Vault's system namespaces, in stored key order (after the platform's). */
export const APP_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [
  VAULT_UI_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_FEATURES_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The platform AI slice's policy; Vault's extra field is `VAULT_AI_SETTINGS_EXTENSION`.
  AI_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_CARDS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  VAULT_BACKUPS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The platform telemetry slice's policy (E9.2, #90): off and inert by default.
  TELEMETRY_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The agent API's kill switch and limits (E14.6): appended, never inserted.
  VAULT_AGENT_ACCESS_SYSTEM_SETTINGS as SystemSettingsNamespace,
];

// -----------------------------------------------------------------------------
// ai extension
// -----------------------------------------------------------------------------

/** The model card extraction runs on until an administrator picks another. */
export const DEFAULT_CARD_EXTRACT_MODEL = 'gpt-4o-mini';

/**
 * What Vault adds to the platform's `ai` namespace: the model the `card_extract`
 * feature runs on (`VaultAiTargetResolver`). The platform has no per-feature
 * model, and the per-user default model is off (`perUserDefaultModel: false`).
 * It replaces the old `ai.model`. NO FIELD HERE CAN HOLD A KEY: provider keys are
 * credentials (`/api/admin/ai/*`).
 */
export const vaultAiExtensionSchema = z.object({
  cardExtractModel: z.string().trim().min(1).max(128),
  /** The provider of `cardExtractModel` (#213); unset means `openai`, the provider of every row before it. */
  cardExtractProvider: z.string().trim().min(1).max(64).optional(),
  /** The model `document_extract` runs on (#210); unset means `cardExtractModel`. */
  documentExtractModel: z.string().trim().min(1).max(128).optional(),
  /** The provider of `documentExtractModel` (#213); unset means `openai`. */
  documentExtractProvider: z.string().trim().min(1).max(64).optional(),
});
export type VaultAiExtensionValue = z.infer<typeof vaultAiExtensionSchema>;

/**
 * A patch of the extension: every field optional, and the two document fields also accept `null`,
 * which CLEARS them ("Same as card scanning", #213). A patch that sets a model without its provider
 * clears the stored provider, so a choice never keeps the provider of an earlier one.
 */
export const vaultAiExtensionPatchSchema = z.object({
  cardExtractModel: vaultAiExtensionSchema.shape.cardExtractModel.optional(),
  cardExtractProvider: z.string().trim().min(1).max(64).nullable().optional(),
  documentExtractModel: z.string().trim().min(1).max(128).nullable().optional(),
  documentExtractProvider: z.string().trim().min(1).max(64).nullable().optional(),
});
export type VaultAiExtensionPatch = z.infer<typeof vaultAiExtensionPatchSchema>;

/** The extension's fields of `current` with `patch` applied (see {@link vaultAiExtensionPatchSchema}). */
export function mergeVaultAiExtension(
  current: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...current };
  if (!patch) return next;
  const pairs = [
    ['cardExtractModel', 'cardExtractProvider'],
    ['documentExtractModel', 'documentExtractProvider'],
  ] as const;
  for (const [modelKey, providerKey] of pairs) {
    if (patch[modelKey] === null) {
      delete next[modelKey];
      delete next[providerKey];
      continue;
    }
    if (patch[modelKey] !== undefined) {
      next[modelKey] = patch[modelKey];
      if (patch[providerKey] === undefined) delete next[providerKey];
    }
    if (patch[providerKey] === null) delete next[providerKey];
    else if (patch[providerKey] !== undefined) next[providerKey] = patch[providerKey];
  }
  return next;
}

const EXTENSION_FIELDS = Object.keys(vaultAiExtensionSchema.shape);

export const VAULT_AI_SETTINGS_EXTENSION: SystemSettingsNamespaceExtension = {
  key: 'ai',
  storedSchema: vaultAiExtensionSchema,
  patchSchema: vaultAiExtensionPatchSchema,
  wirePatchSchema: vaultAiExtensionPatchSchema,
  defaults: { cardExtractModel: DEFAULT_CARD_EXTRACT_MODEL },
  // The platform's merge for its own fields, then the extension's fields with `null` clearing.
  merge: (current, patch, baseMerge) => {
    const merged = (baseMerge(current, patch) ?? {}) as Record<string, unknown>;
    const ownCurrent = Object.fromEntries(EXTENSION_FIELDS.filter((k) => k in current).map((k) => [k, current[k]]));
    const base = Object.fromEntries(Object.entries(merged).filter(([k]) => !EXTENSION_FIELDS.includes(k)));
    return { ...base, ...mergeVaultAiExtension(ownCurrent, patch) };
  },
};

/**
 * The `ai` namespace for typed reads: the platform's stored schema widened by
 * the extension (`getNamespace(declaration)` types a read from `storedSchema`;
 * at run time only `key` matters and the registered, extended namespace answers).
 */
export const VAULT_AI_POLICY = {
  key: 'ai',
  storedSchema: AI_SYSTEM_SETTINGS.storedSchema.extend(vaultAiExtensionSchema.shape),
} as const;

/** Fields Vault adds to platform-declared system namespaces. */
export const APP_SYSTEM_SETTINGS_EXTENSIONS: readonly SystemSettingsNamespaceExtension[] = [
  VAULT_AI_SETTINGS_EXTENSION,
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
    agentAccess: AgentAccessSettings;
  }

  interface UserProfileSettingsExtensions {
    customImageUrl?: string;
  }
}
