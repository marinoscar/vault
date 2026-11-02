// The settings slice's host ports: SETTINGS_DATA -> PrismaService.runInOrg,
// SETTINGS_PROFILE_IMAGES -> Vault's (upload-less) adapter. `@Global()` so the
// slice's services resolve both from whichever module instantiates them.

import { Global, Module } from '@nestjs/common';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES } from '@marinoscar/platform-api/settings';

import { SettingsDataAdapter } from './settings-data.adapter';
import { SettingsProfileImagesAdapter } from './settings-profile-images.adapter';

@Global()
@Module({
  providers: [
    { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
    { provide: SETTINGS_PROFILE_IMAGES, useClass: SettingsProfileImagesAdapter },
  ],
  exports: [SETTINGS_DATA, SETTINGS_PROFILE_IMAGES],
})
export class SettingsHostModule {}
