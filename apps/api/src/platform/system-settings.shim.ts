// =============================================================================
// PLATFORM-ADOPTION-SHIM(E4.1): the platform `SystemSettingsService`, for the host
// =============================================================================
//
// The host core (maintenance mode, the Doctor's `core.deployment-mode` check)
// injects the settings slice's `SystemSettingsService`. Vault adopts the settings
// slice in E4.1, and until then its `/api/system-settings` routes are its own
// (`src/settings/system-settings`), which the platform slice would collide with.
//
// This class answers the three calls the host makes, over the SAME `system_settings`
// row (`key = 'global'`) the legacy service writes, so the `maintenance` namespace
// lives beside `ui`, `features` and `ai`:
//
//   * `readNamespaceValue` / `getMaintenancePolicy`: READ ONLY, never creates the row.
//   * `patchSettings({ maintenance })`: merges the `maintenance` namespace, bumps
//     `version`, checks `ifMatch` optimistically.
//
// The legacy service keeps every key it does not own (`systemSettingsSchema` is
// loose, and its merges spread the stored value), so neither side erases the
// other's keys. Delete this file when E4.1 mounts `SettingsModule.forRoot`.
// =============================================================================

import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import { SystemSettingsService as PlatformSystemSettingsService } from '@marinoscar/platform-api/settings';
import { MAINTENANCE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/host';
import type { SystemSettingsSnapshot, SystemSettingsStore } from '@marinoscar/platform-api/core';

import { DEFAULT_SYSTEM_SETTINGS } from '../common/types/settings.types';
import { PrismaService } from '../prisma/prisma.service';

/** The `system_settings` row every system namespace lives in (the legacy service's key). */
export const SYSTEM_SETTINGS_ROW_KEY = 'global';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class SystemSettingsShim implements SystemSettingsStore {
  constructor(private readonly prisma: PrismaService) {}

  /** The stored namespace, or its defaults when absent or unreadable. Never writes. */
  async readNamespaceValue(namespace: string): Promise<unknown> {
    const row = await this.prisma.systemSettings.findUnique({
      where: { key: SYSTEM_SETTINGS_ROW_KEY },
      select: { value: true },
    });
    return this.salvage(namespace, isObject(row?.value) ? row.value[namespace] : undefined);
  }

  async getMaintenancePolicy(): Promise<unknown> {
    return this.readNamespaceValue('maintenance');
  }

  /** `SystemSettingsStore.read`: the namespace value and the row version (0 when absent). */
  async read(namespace: string): Promise<SystemSettingsSnapshot> {
    const [value, row] = await Promise.all([
      this.readNamespaceValue(namespace),
      this.prisma.systemSettings.findUnique({ where: { key: SYSTEM_SETTINGS_ROW_KEY }, select: { version: true } }),
    ]);
    return { value, version: row?.version ?? 0 };
  }

  /** `SystemSettingsStore.patch`. */
  async patch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: { actorUserId: string; ifMatchVersion?: number },
  ): Promise<SystemSettingsSnapshot> {
    const updated = await this.patchSettings({ [namespace]: patch }, ctx.actorUserId, ctx.ifMatchVersion);
    return { value: updated[namespace], version: updated.version };
  }

  /**
   * Merges a patch of namespaces into the row. Only the `maintenance` namespace
   * is merged here (the only one the host patches); any other key is rejected so
   * a caller cannot silently lose a write.
   */
  async patchSettings(
    dto: Record<string, unknown>,
    userId: string,
    expectedVersion?: number,
  ): Promise<Json & { version: number }> {
    const unsupported = Object.keys(dto).filter((key) => key !== 'maintenance');
    if (unsupported.length > 0) {
      throw new Error(`SystemSettingsShim cannot patch namespace(s): ${unsupported.join(', ')} (settings slice lands in E4.1)`);
    }

    const row =
      (await this.prisma.systemSettings.findUnique({ where: { key: SYSTEM_SETTINGS_ROW_KEY } })) ??
      (await this.prisma.systemSettings.create({
        data: { key: SYSTEM_SETTINGS_ROW_KEY, value: DEFAULT_SYSTEM_SETTINGS as never },
      }));

    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw new ConflictException(`Settings version mismatch. Expected ${expectedVersion}, found ${row.version}`);
    }

    const stored: Json = isObject(row.value) ? row.value : {};
    const current = this.salvage('maintenance', stored.maintenance) as Parameters<
      typeof MAINTENANCE_SYSTEM_SETTINGS.merge
    >[0];
    const merged = MAINTENANCE_SYSTEM_SETTINGS.storedSchema.parse(
      MAINTENANCE_SYSTEM_SETTINGS.merge(current, dto.maintenance as never),
    );
    const next: Json = { ...stored, maintenance: merged };

    // Optimistic: the row is written only if nobody changed it since it was read.
    const result = await this.prisma.systemSettings.updateMany({
      where: { key: SYSTEM_SETTINGS_ROW_KEY, version: row.version },
      data: { value: next as never, updatedByUserId: userId, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException('Settings were changed concurrently. Reload and try again.');
    }

    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action: 'system_settings:patch',
        targetType: 'system_settings',
        targetId: row.id,
        meta: { namespace: 'maintenance' },
      },
    });

    return { ...next, version: row.version + 1 };
  }

  private salvage(namespace: string, raw: unknown): unknown {
    if (namespace !== 'maintenance') return raw;
    const parsed = MAINTENANCE_SYSTEM_SETTINGS.storedSchema.safeParse({
      ...MAINTENANCE_SYSTEM_SETTINGS.defaults,
      ...(isObject(raw) ? raw : {}),
    });
    return parsed.success ? parsed.data : { ...MAINTENANCE_SYSTEM_SETTINGS.defaults };
  }
}

/** Binds the platform's `SystemSettingsService` token to the shim, globally, for the host core. */
@Global()
@Module({
  providers: [
    SystemSettingsShim,
    { provide: PlatformSystemSettingsService, useExisting: SystemSettingsShim },
  ],
  exports: [SystemSettingsShim, PlatformSystemSettingsService],
})
export class SystemSettingsShimModule {}
