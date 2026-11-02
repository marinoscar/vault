import {
  Injectable,
  Logger,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VAULT_AI_CREDENTIAL_LABEL,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../../platform/credentials/credentials.config';
import { UpdateSystemSettingsDto } from '../dto/update-system-settings.dto';
import { PatchSystemSettingsDto } from '../dto/update-system-settings.dto';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  AiSettings,
  AiSettingsProjection,
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

/** What a PATCH asks of the credential store for the AI key. */
type ApiKeyChange =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'set'; plaintext: string };

const HINT_MASK = '\u2022\u2022\u2022\u2022';

/** The revealed tail of a credential hint (`••••1234` -> `1234`), or null. */
function lastFourOfHint(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const tail = hint.startsWith(HINT_MASK) ? hint.slice(HINT_MASK.length) : hint;
  return tail.length > 0 ? tail : null;
}

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Raw access (internal only)
  // ---------------------------------------------------------------------------

  /**
   * Read the settings row, creating it from defaults if it is missing.
   *
   * INTERNAL ONLY. The returned `value` is the raw stored JSON. Since E4.2 the
   * AI key lives in the credential store, but a row not yet migrated
   * (`npm run vault:migrate-ai-key`) can still hold the legacy encrypted
   * `ai.apiKey` block. Never return this to a caller outside this service - use
   * `toResponse()`.
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
   * merge from here, never from `getSettings()` (the projection has no
   * `apiKey`, and merging it back would strip a not-yet-migrated legacy block).
   */
  private async getRawValue(): Promise<SystemSettingsValue> {
    const settings = await this.getRawRow();
    return settings.value as unknown as SystemSettingsValue;
  }

  /**
   * Build the masked, client-safe response from a settings row.
   */
  private async toResponse(
    settings: Awaited<ReturnType<typeof this.getRawRow>>,
  ) {
    const value = settings.value as unknown as SystemSettingsValue;

    return {
      ui: value.ui,
      features: value.features,
      ai: await this.projectAiSettings(value.ai),
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedByUser,
      version: settings.version,
    };
  }

  /**
   * Reduce stored AI settings to the only shape that may leave the API.
   * Returns null for rows written before the AI block existed.
   *
   * The key's presence and its mask come from the credential store (purpose
   * `ai`, name `openai`): `describe()` returns the non-secret hint, never the
   * ciphertext.
   */
  private async projectAiSettings(
    ai: AiSettings | undefined,
  ): Promise<AiSettingsProjection | null> {
    if (!ai) {
      return null;
    }

    const info = await this.credentials.describe(
      VAULT_AI_CREDENTIAL_PURPOSE,
      VAULT_AI_CREDENTIAL_NAME,
    );

    return {
      enabled: ai.enabled ?? DEFAULT_AI_SETTINGS.enabled,
      provider: 'openai',
      model: ai.model ?? DEFAULT_AI_SETTINGS.model,
      maxCallsPerUserPerDay:
        ai.maxCallsPerUserPerDay ?? DEFAULT_AI_SETTINGS.maxCallsPerUserPerDay,
      apiKeyConfigured: info !== null,
      apiKeyLast4: lastFourOfHint(info?.hint),
      apiKeyUpdatedAt: info ? info.updatedAt.toISOString() : null,
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
    return await this.toResponse(settings);
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

    // Keys this service does not own (the platform's `maintenance`, ...) are
    // carried over verbatim: a PUT replaces `ui` and `features` only.
    const { ui: _ui, features: _features, ai: _ai, ...foreign } =
      current as SystemSettingsValue & Record<string, unknown>;
    const next: SystemSettingsValue = {
      ...foreign,
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
      newValue: this.redactSettingsForAudit(validated, false, null),
    });

    this.logger.log(`System settings replaced by user: ${userId}`);

    return await this.toResponse(settings);
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

    const { ai: nextAi, apiKey } = this.mergeAiSettings(current.ai, dto.ai);

    // Deep merge with existing settings
    const merged: SystemSettingsValue = {
      // Keys this service does not own (the platform's `maintenance`, ...) are
      // kept as stored.
      ...current,
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

    // The key goes to the credential store BEFORE the row is written, so a
    // store failure (no SECRETS_ENCRYPTION_KEY, say) leaves the settings as they
    // were and the admin can retry the whole save.
    const apiKeyLast4 = await this.applyApiKeyChange(apiKey, userId);
    const apiKeyChanged = apiKey.kind !== 'keep';

    const settings = await this.prisma.systemSettings.update({
      where: { key: SETTINGS_KEY },
      data: {
        value: validated as any,
        updatedByUserId: userId,
        version: { increment: 1 },
      },
      include: SETTINGS_INCLUDE,
    });

    // Create audit event. The DTO holds the plaintext key the admin just typed
    // and a not-yet-migrated row holds its legacy ciphertext: the redaction
    // drops both and keeps only the mask.
    await this.createAuditEvent(userId, 'system_settings:patch', settings.id, {
      changes: this.redactSettingsForAudit(dto, apiKeyChanged, apiKeyLast4),
      resultingValue: this.redactSettingsForAudit(
        validated,
        apiKeyChanged,
        apiKeyLast4,
      ),
    });

    this.logger.log(
      `System settings patched by user: ${userId}${
        apiKeyChanged ? ' (ai.apiKey changed)' : ''
      }`,
    );

    return await this.toResponse(settings);
  }

  /**
   * Three-state merge of the AI block.
   *
   * `apiKey` is deliberately tested with `'apiKey' in patch`, not
   * `patch.apiKey !== undefined`: the two states must be distinguished.
   *   - key absent  -> keep the stored credential untouched
   *   - explicit null -> clear the credential
   *   - string      -> replace it
   *
   * The key itself is NOT part of the merged settings: it is returned as an
   * instruction for the credential store (`applyApiKeyChange`). The stored
   * `ai.apiKey` field only ever holds the legacy ciphertext of a row that
   * `vault:migrate-ai-key` has not blanked yet; any explicit change of the key
   * (set or clear) blanks it, because the credential store is now authoritative.
   */
  private mergeAiSettings(
    current: AiSettings | undefined,
    patch: PatchSystemSettingsDto['ai'],
  ): { ai: AiSettings | undefined; apiKey: ApiKeyChange } {
    // Untouched by this PATCH: leave storage exactly as it was, including
    // leaving `ai` absent on rows that never had it.
    if (!patch) {
      return { ai: current, apiKey: { kind: 'keep' } };
    }

    const base: AiSettings = current ?? { ...DEFAULT_AI_SETTINGS };

    let apiKey: ApiKeyChange = { kind: 'keep' };
    if ('apiKey' in patch) {
      const provided = patch.apiKey;
      if (provided === null) {
        apiKey = { kind: 'clear' };
      } else if (typeof provided === 'string') {
        apiKey = { kind: 'set', plaintext: provided };
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
        apiKey: apiKey.kind === 'keep' ? (base.apiKey ?? null) : null,
      },
      apiKey,
    };
  }

  /**
   * Apply a key change to the credential store (purpose `ai`, name `openai`).
   * Returns the new mask (last four characters, when the key is long enough to
   * show any) for the audit row, or null.
   *
   * The store throws when SECRETS_ENCRYPTION_KEY is missing or malformed.
   * Surface that as a 503 the admin can act on rather than an unhandled 500;
   * a store-level HTTP error (a blank first write is a 400) passes through.
   */
  private async applyApiKeyChange(
    change: ApiKeyChange,
    userId: string,
  ): Promise<string | null> {
    if (change.kind === 'keep') {
      return null;
    }

    if (change.kind === 'clear') {
      await this.credentials.deleteSecret(
        VAULT_AI_CREDENTIAL_PURPOSE,
        VAULT_AI_CREDENTIAL_NAME,
      );
      return null;
    }

    try {
      await this.credentials.setSecret(
        VAULT_AI_CREDENTIAL_PURPOSE,
        VAULT_AI_CREDENTIAL_NAME,
        change.plaintext,
        { label: VAULT_AI_CREDENTIAL_LABEL, updatedByUserId: userId },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to store AI API key: ${(error as Error)?.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_UNAVAILABLE',
        message:
          'Encryption is not available, so the API key could not be stored. Check that SECRETS_ENCRYPTION_KEY is configured, then re-enter the key.',
      });
    }

    const info = await this.credentials.describe(
      VAULT_AI_CREDENTIAL_PURPOSE,
      VAULT_AI_CREDENTIAL_NAME,
    );
    return lastFourOfHint(info?.hint);
  }

  /**
   * Strip every secret-bearing field out of a settings object before it is
   * written to `audit_events.meta`.
   *
   * Handles the PATCH DTO shape (`ai.apiKey` is plaintext or null) and the
   * stored shape (`ai.apiKey` is legacy ciphertext or null). Audit rows are
   * permanent and are not rewritten when settings change, so neither plaintext
   * nor ciphertext may ever be recorded here: whatever `ai.apiKey` holds is
   * dropped, and only the mask the credential store derived is kept.
   */
  private redactSettingsForAudit(
    input: unknown,
    apiKeyChanged: boolean,
    apiKeyLast4: string | null,
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
  // Convenience readers
  // ---------------------------------------------------------------------------

  /**
   * Get a specific setting value.
   *
   * NOTE: this reads the MASKED projection, so `ai.apiKey` is not reachable
   * from here by design - `ai` exposes only `apiKeyConfigured` /
   * `apiKeyLast4` / `apiKeyUpdatedAt`. Use `AiConfigService` (the credential store) to
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
