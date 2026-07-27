import {
  Injectable,
  Logger,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { UpdateSystemSettingsDto } from '../dto/update-system-settings.dto';
import { PatchSystemSettingsDto } from '../dto/update-system-settings.dto';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  AiSettings,
  AiSettingsProjection,
  EncryptedSecretValue,
  SystemSettingsValue,
} from '../../common/types/settings.types';
import { systemSettingsSchema } from '../../common/schemas/settings.schema';

const SETTINGS_KEY = 'global';

const SETTINGS_INCLUDE = {
  updatedByUser: {
    select: { id: true, email: true },
  },
} as const;

/** Shape used for audit metadata - masked, never ciphertext, never plaintext. */
interface RedactedAiAudit {
  enabled?: boolean;
  model?: string;
  maxCallsPerUserPerDay?: number;
  apiKeyChanged: boolean;
  apiKeyLast4: string | null;
}

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ---------------------------------------------------------------------------
  // Raw access (internal only)
  // ---------------------------------------------------------------------------

  /**
   * Read the settings row, creating it from defaults if it is missing.
   *
   * INTERNAL ONLY. The returned `value` is the raw stored JSON and therefore
   * still contains the encrypted `ai.apiKey` block. Never return this to a
   * caller outside this service - use `toResponse()`.
   */
  private async getRawRow() {
    let settings = await this.prisma.systemSettings.findUnique({
      where: { key: SETTINGS_KEY },
      include: SETTINGS_INCLUDE,
    });

    if (!settings) {
      // Should have been seeded, but create if missing
      settings = await this.prisma.systemSettings.create({
        data: {
          key: SETTINGS_KEY,
          value: DEFAULT_SYSTEM_SETTINGS as any,
        },
        include: SETTINGS_INCLUDE,
      });
      this.logger.warn('Created default system settings - seed may not have run');
    }

    return settings;
  }

  /**
   * Read the raw stored settings value, bypassing the masked projection that
   * `getSettings()` returns.
   *
   * This exists because merging the masked projection back into storage would
   * overwrite `ai.apiKey` (an encrypted object) with `apiKeyConfigured` (a
   * boolean) and permanently destroy the credential. Every write path must
   * merge from here, never from `getSettings()`.
   */
  private async getRawValue(): Promise<SystemSettingsValue> {
    const settings = await this.getRawRow();
    return settings.value as unknown as SystemSettingsValue;
  }

  /**
   * Build the masked, client-safe response from a settings row.
   */
  private toResponse(settings: Awaited<ReturnType<typeof this.getRawRow>>) {
    const value = settings.value as unknown as SystemSettingsValue;

    return {
      ui: value.ui,
      features: value.features,
      ai: this.projectAiSettings(value.ai),
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedByUser,
      version: settings.version,
    };
  }

  /**
   * Reduce stored AI settings to the only shape that may leave the API.
   * Returns null for rows written before the AI block existed.
   */
  private projectAiSettings(
    ai: AiSettings | undefined,
  ): AiSettingsProjection | null {
    if (!ai) {
      return null;
    }

    return {
      enabled: ai.enabled ?? DEFAULT_AI_SETTINGS.enabled,
      provider: 'openai',
      model: ai.model ?? DEFAULT_AI_SETTINGS.model,
      maxCallsPerUserPerDay:
        ai.maxCallsPerUserPerDay ?? DEFAULT_AI_SETTINGS.maxCallsPerUserPerDay,
      apiKeyConfigured: Boolean(ai.apiKey),
      apiKeyLast4: ai.apiKey?.last4 ?? null,
      apiKeyUpdatedAt: ai.apiKey?.updatedAt ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Public read API
  // ---------------------------------------------------------------------------

  /**
   * Get system settings (masked).
   * Creates default if not found (should exist from seed).
   */
  async getSettings() {
    const settings = await this.getRawRow();
    return this.toResponse(settings);
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Replace system settings (PUT)
   *
   * The PUT DTO carries only `ui` and `features` - it can neither read nor
   * write the encrypted credential. Without an explicit carry-over, replacing
   * settings (e.g. to flip a feature flag) would drop the stored `ai` block
   * entirely and silently destroy the API key, so the current `ai` value is
   * read from raw storage and preserved verbatim.
   */
  async replaceSettings(dto: UpdateSystemSettingsDto, userId: string) {
    const current = await this.getRawValue();

    const next: SystemSettingsValue = {
      ui: dto.ui,
      features: dto.features,
    };

    // Carry the stored credential across the replace. Built explicitly from
    // storage (never from `dto`) so a client cannot inject ciphertext.
    if (current.ai) {
      next.ai = current.ai;
    }

    const validated = systemSettingsSchema.parse(next);

    const settings = await this.prisma.systemSettings.upsert({
      where: { key: SETTINGS_KEY },
      update: {
        value: validated as any,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      create: {
        key: SETTINGS_KEY,
        value: validated as any,
        updatedByUserId: userId,
      },
      include: SETTINGS_INCLUDE,
    });

    // Create audit event (redacted - audit rows outlive settings rewrites, so
    // ciphertext stored here would survive a key rotation forever)
    await this.createAuditEvent(userId, 'system_settings:replace', settings.id, {
      newValue: this.redactSettingsForAudit(validated, false),
    });

    this.logger.log(`System settings replaced by user: ${userId}`);

    return this.toResponse(settings);
  }

  /**
   * Partial update system settings (PATCH)
   */
  async patchSettings(
    dto: PatchSystemSettingsDto,
    userId: string,
    expectedVersion?: number,
  ) {
    // Read the RAW row. Merging from `getSettings()` would fold the masked
    // projection (`apiKeyConfigured: true`) back into storage and destroy the
    // encrypted credential.
    const currentRow = await this.getRawRow();
    const current = currentRow.value as unknown as SystemSettingsValue;

    // Optimistic concurrency check
    if (expectedVersion !== undefined && currentRow.version !== expectedVersion) {
      throw new ConflictException(
        `Settings version mismatch. Expected ${expectedVersion}, found ${currentRow.version}`,
      );
    }

    const { ai: nextAi, apiKeyChanged } = this.mergeAiSettings(
      current.ai,
      dto.ai,
    );

    // Deep merge with existing settings
    const merged: SystemSettingsValue = {
      ui: {
        allowUserThemeOverride:
          dto.ui?.allowUserThemeOverride ??
          current.ui?.allowUserThemeOverride ??
          DEFAULT_SYSTEM_SETTINGS.ui.allowUserThemeOverride,
      },
      features: {
        ...current.features,
        ...(dto.features || {}),
      },
    };

    // Only materialise `ai` if it already existed or the caller touched it.
    if (nextAi) {
      merged.ai = nextAi;
    }

    // Validate merged result
    const validated = systemSettingsSchema.parse(merged);

    const settings = await this.prisma.systemSettings.update({
      where: { key: SETTINGS_KEY },
      data: {
        value: validated as any,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      include: SETTINGS_INCLUDE,
    });

    // Create audit event. BOTH sides are redacted: `dto` holds the plaintext
    // key the admin just typed, `validated` holds its ciphertext.
    await this.createAuditEvent(userId, 'system_settings:patch', settings.id, {
      changes: this.redactSettingsForAudit(dto, apiKeyChanged),
      resultingValue: this.redactSettingsForAudit(validated, apiKeyChanged),
    });

    this.logger.log(
      `System settings patched by user: ${userId}${
        apiKeyChanged ? ' (ai.apiKey changed)' : ''
      }`,
    );

    return this.toResponse(settings);
  }

  /**
   * Three-state merge of the AI block.
   *
   * `apiKey` is deliberately tested with `'apiKey' in patch`, not
   * `patch.apiKey !== undefined`: the two states must be distinguished.
   *   - key absent  -> keep the stored credential untouched
   *   - explicit null -> clear the credential
   *   - string      -> encrypt and replace
   */
  private mergeAiSettings(
    current: AiSettings | undefined,
    patch: PatchSystemSettingsDto['ai'],
  ): { ai: AiSettings | undefined; apiKeyChanged: boolean } {
    // Untouched by this PATCH: leave storage exactly as it was, including
    // leaving `ai` absent on rows that never had it.
    if (!patch) {
      return { ai: current, apiKeyChanged: false };
    }

    const base: AiSettings = current ?? { ...DEFAULT_AI_SETTINGS };

    let apiKey: EncryptedSecretValue | null = base.apiKey ?? null;
    let apiKeyChanged = false;

    if ('apiKey' in patch) {
      const provided = patch.apiKey;
      if (provided === null) {
        apiKey = null;
        apiKeyChanged = true;
      } else if (typeof provided === 'string') {
        apiKey = this.encryptApiKey(provided);
        apiKeyChanged = true;
      }
      // `undefined` (key present but explicitly undefined) keeps the existing
      // credential, same as an absent key.
    }

    return {
      ai: {
        enabled: patch.enabled ?? base.enabled,
        provider: 'openai',
        model: patch.model ?? base.model,
        maxCallsPerUserPerDay:
          patch.maxCallsPerUserPerDay ?? base.maxCallsPerUserPerDay,
        apiKey,
      },
      apiKeyChanged,
    };
  }

  /**
   * Encrypt a plaintext credential for storage.
   *
   * `CryptoService.onModuleInit` only WARNS when VAULT_ENCRYPTION_KEY is
   * missing, so `encrypt()` throws at call time. Surface that as a 503 the
   * admin can act on rather than an unhandled 500.
   */
  private encryptApiKey(plaintext: string): EncryptedSecretValue {
    try {
      const encrypted = this.crypto.encrypt(plaintext);
      return {
        ...encrypted,
        last4: plaintext.slice(-4),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to encrypt AI API key: ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_UNAVAILABLE',
        message:
          'Encryption is not available, so the API key could not be stored. Check that VAULT_ENCRYPTION_KEY is configured, then re-enter the key.',
      });
    }
  }

  /**
   * Strip every secret-bearing field out of a settings object before it is
   * written to `audit_events.meta`.
   *
   * Handles both the PATCH DTO shape (`ai.apiKey` is plaintext or null) and the
   * stored shape (`ai.apiKey` is an encrypted object). Audit rows are permanent
   * and are not rewritten when settings change, so neither plaintext nor
   * ciphertext may ever be recorded here - a ciphertext copy in the audit log
   * would survive a key rotation and defeat it.
   */
  private redactSettingsForAudit(
    input: unknown,
    apiKeyChanged: boolean,
  ): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return {};
    }

    const { ai, ...rest } = input as Record<string, any>;

    if (ai === undefined) {
      return { ...rest };
    }
    if (ai === null) {
      return { ...rest, ai: null };
    }

    const apiKey: unknown = ai.apiKey;
    let apiKeyLast4: string | null = null;
    if (typeof apiKey === 'string') {
      // PATCH DTO shape: plaintext. Only the mask is retained.
      apiKeyLast4 = apiKey.slice(-4);
    } else if (
      apiKey &&
      typeof apiKey === 'object' &&
      typeof (apiKey as EncryptedSecretValue).last4 === 'string'
    ) {
      // Stored shape: ciphertext/iv/authTag are dropped, only the mask kept.
      apiKeyLast4 = (apiKey as EncryptedSecretValue).last4;
    }

    const redacted: RedactedAiAudit = {
      enabled: ai.enabled,
      model: ai.model,
      maxCallsPerUserPerDay: ai.maxCallsPerUserPerDay,
      apiKeyChanged,
      apiKeyLast4,
    };

    return { ...rest, ai: redacted };
  }

  // ---------------------------------------------------------------------------
  // Credential access
  // ---------------------------------------------------------------------------

  /**
   * Resolve the system-wide OpenAI API key in PLAINTEXT.
   *
   * This is the ONLY place the plaintext credential ever exists in memory.
   * `getSettings()` and `getSettingValue()` both return the masked projection
   * and cannot be used for this. Do not log, return, or otherwise propagate the
   * value returned here - hand it straight to the provider client.
   *
   * Returns null when no key is configured.
   * Throws 503 when the vault key is missing or has been rotated (the stored
   * ciphertext can no longer be authenticated), so the admin is told to
   * re-enter the key instead of receiving an opaque 500.
   */
  async getOpenAiApiKeyPlaintext(): Promise<string | null> {
    const value = await this.getRawValue();
    const apiKey = value.ai?.apiKey;

    if (!apiKey) {
      return null;
    }

    try {
      return this.crypto.decrypt(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrypt AI API key: ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'AI_API_KEY_UNREADABLE',
        message:
          'The stored OpenAI API key could not be decrypted. The encryption key is missing or has been rotated - an administrator must re-enter the API key in System Settings.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Convenience readers
  // ---------------------------------------------------------------------------

  /**
   * Get a specific setting value.
   *
   * NOTE: this reads the MASKED projection, so `ai.apiKey` is not reachable
   * from here by design - `ai` exposes only `apiKeyConfigured` /
   * `apiKeyLast4` / `apiKeyUpdatedAt`. Use `getOpenAiApiKeyPlaintext()` to
   * obtain the credential.
   */
  async getSettingValue<T>(path: string): Promise<T | undefined> {
    const settings = await this.getSettings();
    const parts = path.split('.');

    let value: any = settings;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }

    return value as T;
  }

  /**
   * Check if a feature flag is enabled
   */
  async isFeatureEnabled(featureName: string): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.features[featureName] ?? false;
  }

  /**
   * Create audit event
   */
  private async createAuditEvent(
    actorUserId: string,
    action: string,
    targetId: string,
    meta: Record<string, unknown>,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action,
        targetType: 'system_settings',
        targetId,
        meta: meta as any,
      },
    });
  }
}
