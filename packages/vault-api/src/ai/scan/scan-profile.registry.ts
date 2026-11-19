import { Injectable } from '@nestjs/common';

import { cardScanProfile } from '../card-scan.profile';
import { idDocumentScanProfile } from './profiles/id-document.profile';
import { passportScanProfile } from './profiles/passport.profile';
import type { ScanProfile } from './scan-profile';

/**
 * The registered scan profiles, keyed by `id`. The card is registered by
 * {@link createScanProfileRegistry}, which the module uses to provide it.
 *
 * @stability experimental
 */
@Injectable()
export class ScanProfileRegistry {
  private readonly profiles = new Map<string, ScanProfile<any, any>>();

  /** Adds a profile; a second profile with the same id throws. */
  register<TModel, TResult>(profile: ScanProfile<TModel, TResult>): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`Scan profile "${profile.id}" is already registered`);
    }
    this.profiles.set(profile.id, profile as ScanProfile<any, any>);
  }

  /** The profile with this id; an unknown id throws. */
  get<TModel = unknown, TResult = unknown>(id: string): ScanProfile<TModel, TResult> {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`Unknown scan profile "${id}"`);
    return profile as ScanProfile<TModel, TResult>;
  }

  /** Every registered profile, in registration order. */
  list(): ScanProfile<any, any>[] {
    return [...this.profiles.values()];
  }
}

/**
 * A registry holding the built-in profiles: `card`, `passport` and `id_document`.
 *
 * @stability experimental
 */
export function createScanProfileRegistry(): ScanProfileRegistry {
  const registry = new ScanProfileRegistry();
  registry.register(cardScanProfile);
  registry.register(passportScanProfile);
  registry.register(idDocumentScanProfile);
  return registry;
}
