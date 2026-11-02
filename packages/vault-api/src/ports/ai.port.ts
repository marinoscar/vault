import type { AiConfigService, AiService } from '@marinoscar/platform-api/ai';

/**
 * VAULT_AI: the platform AI slice. The only way the package reaches a model: server-side, under a
 * key the platform resolved for that call. The card CVV is never sent to AI.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_AI = Symbol.for('@marinoscar/vault/VAULT_AI');

/** `AiService.forUser(userId, { orgId, feature })`. */
export type VaultAiPort = Pick<AiService, 'forUser'>;

/**
 * VAULT_AI_CONFIG: the public AI configuration of one organization (is AI on, which model).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_AI_CONFIG = Symbol.for('@marinoscar/vault/VAULT_AI_CONFIG');

/** `AiConfigService.describePublic(orgId)`. */
export type VaultAiConfigPort = Pick<AiConfigService, 'describePublic'>;

/**
 * VAULT_AI_KEY_PRESENCE: whether the deployment's AI key is stored. A `describe`, never the secret;
 * the backup archive's `system/settings.json` is its only reader.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_AI_KEY_PRESENCE = Symbol.for('@marinoscar/vault/VAULT_AI_KEY_PRESENCE');

/** The presence port. */
export interface VaultAiKeyPresencePort {
  /** True when a deployment AI key is stored. */
  isConfigured(): Promise<boolean>;
}
