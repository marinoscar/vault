import type { StorageProvider } from '@marinoscar/platform-api/storage';

/**
 * VAULT_OBJECT_STORE: the raw object-storage provider (the platform's storage slice).
 *
 * The RAW provider, not the objects service: deleting an orphaned blob must not inherit the
 * uploader-ownership check. Storage is configured at runtime in the admin UI; there is no
 * environment variable behind it.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_OBJECT_STORE = Symbol.for('@marinoscar/vault/VAULT_OBJECT_STORE');

/** The provider methods the slices use. */
export type VaultObjectStorePort = Pick<
  StorageProvider,
  'upload' | 'download' | 'delete' | 'exists' | 'getBucket' | 'getSignedDownloadUrl'
>;

/**
 * VAULT_OBJECTS: the storage objects service (database row plus blob), used by media where the
 * uploader-ownership check is wanted.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_OBJECTS = Symbol.for('@marinoscar/vault/VAULT_OBJECTS');

/** The objects-service methods media uses. */
export interface VaultObjectsPort {
  /** Deletes a storage object (blob and row) the user uploaded. */
  delete(id: string, userId: string, orgId: string, options?: { canDeleteAny?: boolean }): Promise<unknown>;
  /** A short-lived signed download URL for an object the user may read. */
  getDownloadUrl(id: string, userId: string, orgId: string, expiresIn?: number): Promise<{ url: string; expiresIn: number }>;
}
