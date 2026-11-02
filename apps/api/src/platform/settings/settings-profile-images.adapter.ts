import { Injectable } from '@nestjs/common';
import { PROFILE_IMAGE_SOURCES } from '@marinoscar/platform-contract/settings';
import type { NormalizedProfileSettings, SettingsProfileImages } from '@marinoscar/platform-api/settings';

/**
 * The settings slice's `SETTINGS_PROFILE_IMAGES` port.
 *
 * Vault has no avatar upload (the storage slice's ProfileImageModule is not mounted,
 * E6.1: there is no avatar UI), so no object is ever "a usable uploaded avatar" and `imageSource: 'upload'` is refused. A stored
 * profile is normalised on read: a row written before E4.1 carries
 * `useProviderImage` (false becomes `none`, anything else `provider`).
 */
@Injectable()
export class SettingsProfileImagesAdapter implements SettingsProfileImages {
  normalize(stored: unknown): NormalizedProfileSettings {
    const profile = (stored !== null && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    const source = (PROFILE_IMAGE_SOURCES as readonly unknown[]).includes(profile.imageSource)
      ? (profile.imageSource as NormalizedProfileSettings['imageSource'])
      : profile.useProviderImage === false
        ? 'none'
        : 'provider';
    const normalized: NormalizedProfileSettings = {
      // An upload needs an avatar object Vault cannot hold yet.
      imageSource: source === 'upload' ? 'provider' : source,
      imageObjectId: null,
    };
    if (typeof profile.displayName === 'string') normalized.displayName = profile.displayName;
    return normalized;
  }

  async isUploadedAvatar(): Promise<boolean> {
    return false;
  }
}
