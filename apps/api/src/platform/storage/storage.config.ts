// =============================================================================
// The storage slice's composition (issue #84, E6.1, epic #61)
// =============================================================================
//
// `StorageModule.forRoot` serves `/api/storage/objects` (the same paths Vault
// always had), `GET /api/storage/status`, the `storage.cleanup.stale-uploads` and
// `storage.object.process` job types and the stale-upload cron (which only
// enqueues). `StorageConfigModule` serves `/api/admin/storage-config` and the
// `storage.*` Doctor checks. They replace Vault's own `src/storage/` folder.
//
// The object store is RUNTIME-CONFIGURED: the active driver and its non-secret
// settings are the `storage` system-settings namespace and the secret access key
// is in the credential store (`storage/default`, encrypted with
// SECRETS_ENCRYPTION_KEY). `STORAGE_PROVIDER`, `S3_*` and `AWS_*` are no longer
// the configuration: `StorageEnvImportService` copies them ONCE into the runtime
// configuration when that is still empty, and `npm run vault:migrate-storage-config`
// does the same on demand (runbook: docs/runbooks/storage-config-migration.md).
//
// ORDER: the key-prefix manifest registers before the registry freezes.
//
// THE CONSTANTS BELOW ARE SINGLETONS: a module that needs `ObjectsService` imports
// `storageModule` (the same dynamic-module object), never a second
// `StorageModule.forRoot()`.
//
// Avatar uploads (`ProfileImageModule`) are NOT mounted: Vault has no avatar
// upload UI, and its profile pictures stay the provider image or a URL
// (`profile.customImageUrl`, docs/platform-adoption/local-exceptions.md).
// =============================================================================

import { StorageConfigModule, StorageModule } from '@marinoscar/platform-api/storage';

import './storage-key-prefix.manifest';
import { StorageHostModule } from './storage-host.module';

/**
 * Ceiling of the simple (streamed through the API) upload. Vault's web client and
 * CLI upload every file this way, and the API accepted up to 10 GiB, so the
 * platform's 100 MiB default would break large media files. `MAX_FILE_SIZE`
 * (default 10 GiB) still bounds each upload below this.
 */
export const VAULT_MAX_SIMPLE_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export const storageModule = StorageModule.forRoot({
  imports: [StorageHostModule],
  maxSimpleUploadBytes: VAULT_MAX_SIMPLE_UPLOAD_BYTES,
});

export { StorageConfigModule };
