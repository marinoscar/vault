import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';

import type { AiObjectStore } from '@marinoscar/platform-api/ai';

// =============================================================================
// AI_OBJECT_STORE: SHIM(E6) (issue #87, E8.1)
// =============================================================================
//
// Image, audio and file-input AI runs read and write platform storage objects
// through this port. Vault's storage is still its own provider (the platform
// storage slice is E6), and the only AI feature Vault has, card extraction, sends
// its images inline and stores nothing. So this port refuses every operation with
// a clear reason; the platform maps that to "storage not configured" for an image
// or audio run, which Vault does not expose (no `/api/ai/images` consumer in the
// web, and `ai.defaults.allowBackgroundRuns` is irrelevant to a synchronous call).
//
// E6 replaces this class with an adapter over the platform `STORAGE_PROVIDER`
// (see KVox's `platform/ai/ai-object-store.adapter.ts`).
// =============================================================================

const REASON = 'storage_not_configured';

@Injectable()
export class AiObjectStoreAdapter implements AiObjectStore {
  /** Where an administrator would fix it; the platform storage page arrives with E6. */
  readonly settingsPath = '/admin/settings';

  private unavailable(): never {
    throw new Error(REASON);
  }

  upload(_key: string, _body: Readable): Promise<{ bucket: string }> {
    return this.unavailable();
  }

  delete(_key: string): Promise<void> {
    return this.unavailable();
  }

  download(_key: string): Promise<Readable> {
    return this.unavailable();
  }

  getSignedDownloadUrl(_key: string): Promise<string> {
    return this.unavailable();
  }

  assertWritable(): Promise<void> {
    return this.unavailable();
  }

  activeProvider(): Promise<string> {
    return Promise.resolve('none');
  }

  notConfiguredReason(err: unknown): string | null {
    return err instanceof Error && err.message === REASON ? REASON : null;
  }
}
