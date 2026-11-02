import { Inject, Injectable } from '@nestjs/common';
import type { NodeObjectStore, SignedPutUrlOptions, SignedUrlOptions } from '@marinoscar/platform-api/nodes';

import { STORAGE_PROVIDER } from '../../storage/providers/storage-provider.interface';
import type { StorageProvider } from '../../storage/providers/storage-provider.interface';

/**
 * PLATFORM-ADOPTION-SHIM(E6): the node data plane's `NODE_OBJECT_STORE` over
 * Vault's legacy storage provider.
 *
 * Signed downloads map one to one. Vault's provider only mints multipart part
 * URLs, not a single signed PUT, and no node-eligible job type exists to ask for
 * one, so `getSignedPutUrl` refuses until the storage slice (E6) replaces the
 * provider with the platform's `nodeObjectStoreBinding`.
 *
 * A URL is a bearer capability: never log it.
 */
@Injectable()
export class VaultNodeObjectStore implements NodeObjectStore {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  getSignedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    return this.storage.getSignedDownloadUrl(key, options);
  }

  getSignedPutUrl(_key: string, _options?: SignedPutUrlOptions): Promise<string> {
    return Promise.reject(
      new Error('Signed PUT URLs for worker nodes arrive with the storage slice (E6); no node-eligible job type exists yet'),
    );
  }
}
