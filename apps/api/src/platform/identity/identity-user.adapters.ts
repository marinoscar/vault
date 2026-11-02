import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';

import { DEFAULT_USER_SETTINGS } from '@marinoscar/platform-api/settings';

/**
 * Identity's `USER_DEFAULTS`: what a new user's `user_settings.value` holds at
 * creation. the settings slice's default document (`theme: 'system'`,
 * `profile.imageSource: 'provider'`).
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
 * provider's, unless the user's profile opts out of it (`imageSource: 'none'`;
 * a row from before E4.1 says `useProviderImage: false`) and names a custom URL
 * (`profile.customImageUrl`, a Vault profile field). `none` without a URL is no
 * picture (initials).
 */
@Injectable()
export class VaultProfileImages implements IdentityProfileImages {
  resolveImageUrl(
    user: { id: string; providerProfileImageUrl: string | null },
    storedProfile: unknown,
  ): string | null {
    const profile = (storedProfile ?? {}) as {
      imageSource?: unknown;
      useProviderImage?: unknown;
      customImageUrl?: unknown;
    };
    const optedOut = profile.imageSource === 'none' || profile.useProviderImage === false;
    if (!optedOut) return user.providerProfileImageUrl;
    return typeof profile.customImageUrl === 'string' && profile.customImageUrl ? profile.customImageUrl : null;
  }

  hasUploadedImage(_storedProfile: unknown): boolean {
    return false;
  }
}
