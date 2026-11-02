import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';

import { DEFAULT_USER_SETTINGS } from '../../common/types/settings.types';

/**
 * Identity's `USER_DEFAULTS`: what a new user's `user_settings.value` holds at
 * creation. Vault's own default document (`theme`, `profile.useProviderImage`);
 * E4.1 moves it to the settings slice's.
 */
@Injectable()
export class VaultUserDefaults implements UserDefaults {
  userSettings(): Record<string, unknown> {
    // A fresh object per user: the document is stored and later mutated.
    return structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, unknown>;
  }
}

/**
 * Identity's `IDENTITY_PROFILE_IMAGES`: which picture `/api/auth/me` and
 * `/api/users` report. Vault has no profile-picture upload: the picture is the
 * provider's, unless the user's settings opt out of it and name a custom URL
 * (`profile.useProviderImage = false` plus `profile.customImageUrl`).
 */
@Injectable()
export class VaultProfileImages implements IdentityProfileImages {
  resolveImageUrl(
    user: { id: string; providerProfileImageUrl: string | null },
    storedProfile: unknown,
  ): string | null {
    const profile = (storedProfile ?? {}) as { useProviderImage?: unknown; customImageUrl?: unknown };
    if (profile.useProviderImage === false && typeof profile.customImageUrl === 'string' && profile.customImageUrl) {
      return profile.customImageUrl;
    }
    return user.providerProfileImageUrl;
  }

  hasUploadedImage(_storedProfile: unknown): boolean {
    return false;
  }
}
