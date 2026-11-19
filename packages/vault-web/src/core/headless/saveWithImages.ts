import { useCallback, useEffect, useRef } from 'react';

import {
  createSecret,
  deleteSecret,
  deleteStorageObject,
  linkSecretAttachment,
  simpleStorageUpload,
} from './api.js';
import type { AttachmentRole } from './types.js';

/** One image to store with a new secret, under its attachment role. */
export interface SecretImageUpload {
  role: AttachmentRole;
  file: File;
}

export interface SaveSecretWithImagesInput {
  name: string;
  typeId: string;
  /** The secret's data, already cleaned by the caller. */
  data: Record<string, unknown>;
  images: readonly SecretImageUpload[];
}

export interface SaveSecretWithImagesResult {
  secretId: string;
  /**
   * The roles whose image could not be uploaded or linked. The secret is kept
   * (losing hand-checked details over a failed image would be worse) and the
   * orphaned uploads are deleted.
   */
  failedRoles: AttachmentRole[];
}

export interface UseSaveSecretWithImagesResult {
  /**
   * Create the secret, then upload each image and link it with its role.
   * Rejects only when the secret itself could not be created, after deleting
   * anything it made.
   */
  saveSecretWithImages: (input: SaveSecretWithImagesInput) => Promise<SaveSecretWithImagesResult>;
  /** Delete anything created but not committed. Never throws; safe to call repeatedly. */
  cleanup: () => Promise<void>;
}

/**
 * The save half of the scan flows (card import, document scan): create the
 * secret, upload and link each cropped image, and make sure nothing is left
 * behind when a step fails or the user walks away (unmount).
 *
 * Everything created but not yet committed is held in refs, not state, because
 * the unmount cleanup has to see the CURRENT values — a stale closure over
 * state would leak exactly the objects it exists to delete.
 */
export function useSaveSecretWithImages(): UseSaveSecretWithImagesResult {
  const orphanObjectIdsRef = useRef<Set<string>>(new Set());
  const uncommittedSecretIdRef = useRef<string | null>(null);

  /**
   * Best effort, never throws. Cleanup runs on paths that are already failing
   * or already unmounting; a rejection here would replace a useful error with a
   * useless one, or reject inside an effect teardown.
   */
  const cleanup = useCallback(async () => {
    const objectIds = [...orphanObjectIdsRef.current];
    orphanObjectIdsRef.current.clear();
    const secretId = uncommittedSecretIdRef.current;
    uncommittedSecretIdRef.current = null;

    await Promise.allSettled([
      ...objectIds.map((id) => deleteStorageObject(id)),
      // Deleting the secret also deletes the storage objects behind its linked
      // attachments, so linked ids are removed from the orphan set as they are
      // linked and are not double-deleted here.
      ...(secretId ? [deleteSecret(secretId)] : []),
    ]);
  }, []);

  // Walking away — back button, browser navigation, closing the flow — must
  // not leave an image sitting in storage that nothing points at.
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const saveSecretWithImages = useCallback(
    async ({ name, typeId, data, images }: SaveSecretWithImagesInput): Promise<SaveSecretWithImagesResult> => {
      try {
        const secret = await createSecret({ name: name.trim(), typeId, data });
        uncommittedSecretIdRef.current = secret.id;

        const failedRoles: AttachmentRole[] = [];
        for (const image of images) {
          try {
            const object = await simpleStorageUpload(image.file);
            orphanObjectIdsRef.current.add(object.id);
            await linkSecretAttachment(secret.id, object.id, image.file.name, image.role);
            // Now owned by the secret: deleting the secret would delete it too,
            // so it is no longer an orphan and must not be deleted twice.
            orphanObjectIdsRef.current.delete(object.id);
          } catch {
            failedRoles.push(image.role);
          }
        }

        // Committed. Clearing these is what stops the unmount cleanup from
        // deleting the secret the user just saved.
        uncommittedSecretIdRef.current = null;
        const orphans = [...orphanObjectIdsRef.current];
        orphanObjectIdsRef.current.clear();
        await Promise.allSettled(orphans.map((id) => deleteStorageObject(id)));

        return { secretId: secret.id, failedRoles };
      } catch (err) {
        // The secret itself failed, so nothing of value exists to keep.
        await cleanup();
        throw err;
      }
    },
    [cleanup],
  );

  return { saveSecretWithImages, cleanup };
}

/**
 * Trim every string value and drop the empty ones: a blank optional field is
 * absent, not an empty value the detail view renders as ''. Non-string values
 * (a `keyvalue` list) are kept as given.
 */
export function compactSecretData(values: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') data[key] = trimmed;
    } else if (value !== undefined && value !== null) {
      data[key] = value;
    }
  }
  return data;
}
