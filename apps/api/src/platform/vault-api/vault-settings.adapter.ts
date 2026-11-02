import { Injectable } from '@nestjs/common';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import type { VaultSettingsPort } from '@marinoscar/vault-api/ports';

/**
 * The package's `VAULT_SETTINGS` over the platform system settings. A slice names the namespace
 * it reads (`vaultCards`, `vaultBackups`, `ai`); the registrations in `app-registrations/settings.ts`
 * give it its schema and defaults.
 */
@Injectable()
export class VaultSettingsAdapter implements VaultSettingsPort {
  constructor(private readonly settings: SystemSettingsService) {}

  getNamespace<T = Record<string, unknown>>(name: string): Promise<T> {
    return (this.settings as unknown as { getNamespace(n: string): Promise<unknown> }).getNamespace(name) as Promise<T>;
  }

  getSettings(): Promise<unknown> {
    return this.settings.getSettings();
  }
}
