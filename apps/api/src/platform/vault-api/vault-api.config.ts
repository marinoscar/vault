// =============================================================================
// The Vault domain package, mounted (issue #103, E12.2, epic #67)
// =============================================================================
//
// `@marinoscar/vault-api` holds the domain slices: secrets, secret types, attachments, the export
// zip, backups, media, card extraction and the card-expiry reminders. This file is the only place
// the app binds its ports. Every binding is a platform slice or a one-screen adapter; none of them
// holds domain logic (`test/architecture/no-domain-logic.spec.ts` keeps it that way).
//
//   VAULT_PRISMA          PrismaService (the ordinary application role)
//   VAULT_CRYPTO          CryptoService (AES-256-GCM under VAULT_ENCRYPTION_KEY)
//   VAULT_OBJECT_STORE    the platform's raw STORAGE_PROVIDER
//   VAULT_OBJECTS         the platform's ObjectsService
//   VAULT_JOBS            JobsService + JobHandlerRegistry (VaultJobsAdapter)
//   VAULT_NOTIFY          NotificationsService (global)
//   VAULT_AI              AiService; VAULT_AI_CONFIG AiConfigService (both from `aiModule`)
//   VAULT_AI_KEY_PRESENCE AiKeyPresence (a `describe` of the stored AI credential)
//   VAULT_AUDIT           VaultAuditAdapter over `audit_events`
//   VAULT_SETTINGS        VaultSettingsAdapter over SystemSettingsService
//   VAULT_METRICS         VaultMetricsService (global)
//
// ORDER IN AppModule: after `jobsModule`, `settingsModule`, `notificationsModule`, `storageModule`
// and `VaultMetricsModule`, which provide what the adapters read.
// =============================================================================

import { Module } from '@nestjs/common';
import { AiConfigService, AiService } from '@marinoscar/platform-api/ai';
import { ObjectsService, STORAGE_PROVIDER, type StorageProvider, StorageProvidersModule } from '@marinoscar/platform-api/storage';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { VaultApiModule } from '@marinoscar/vault-api';
import type {
  VaultAiConfigPort,
  VaultAiKeyPresencePort,
  VaultAiPort,
  VaultCryptoPort,
  VaultNotifyPort,
  VaultObjectsPort,
  VaultObjectStorePort,
  VaultPrismaClient,
} from '@marinoscar/vault-api/ports';

import { CommonModule } from '../../common/common.module';
import { CryptoService } from '../../common/services/crypto.service';
import { VaultMetricsService } from '../../common/otel/vault-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { aiModule } from '../ai/ai.config';
import { AiKeyPresence, AiKeyPresenceModule } from '../credentials/ai-key-presence.service';
import { storageModule } from '../storage/storage.config';
import { VaultAuditAdapter } from './vault-audit.adapter';
import { VaultJobsAdapter } from './vault-jobs.adapter';
import { VaultSettingsAdapter } from './vault-settings.adapter';

// Compile-time proof that each platform class still satisfies the port it is bound to: a platform
// release that changes a method breaks THIS file, not a request at run time.
type Satisfies<T extends U, U> = T;
export type VaultPortBindingsCheck = [
  Satisfies<PrismaService, VaultPrismaClient>,
  Satisfies<CryptoService, VaultCryptoPort>,
  Satisfies<ObjectsService, VaultObjectsPort>,
  Satisfies<NotificationsService, VaultNotifyPort>,
  Satisfies<AiService, VaultAiPort>,
  Satisfies<AiConfigService, VaultAiConfigPort>,
  Satisfies<StorageProvider, VaultObjectStorePort>,
  Satisfies<AiKeyPresence, VaultAiKeyPresencePort>,
];

/** The adapters that have no platform class of their own. */
@Module({
  imports: [CommonModule, StorageProvidersModule],
  providers: [VaultJobsAdapter, VaultAuditAdapter, VaultSettingsAdapter],
  exports: [VaultJobsAdapter, VaultAuditAdapter, VaultSettingsAdapter],
})
class VaultAdaptersModule {}

export const vaultApiModule = VaultApiModule.forRoot({
  imports: [VaultAdaptersModule, CommonModule, StorageProvidersModule, storageModule, aiModule, AiKeyPresenceModule],
  bindings: {
    prisma: { useExisting: PrismaService },
    crypto: { useExisting: CryptoService },
    objectStore: { useExisting: STORAGE_PROVIDER },
    objects: { useExisting: ObjectsService },
    jobs: { useExisting: VaultJobsAdapter },
    notify: { useExisting: NotificationsService },
    ai: { useExisting: AiService },
    aiConfig: { useExisting: AiConfigService },
    aiKeyPresence: { useExisting: AiKeyPresence },
    audit: { useExisting: VaultAuditAdapter },
    settings: { useExisting: VaultSettingsAdapter },
    metrics: { useExisting: VaultMetricsService },
  },
});
