import { Prisma } from '@prisma/client';
import { APP_SLUG } from '@app/shared';
import { ExportsModule, registerExportSource } from '@marinoscar/platform-api/exports';

import { VAULT_SECRETS_EXPORT_SOURCE } from './vault-secrets.source';
import { ExportsHostModule } from './exports-host.module';

// =============================================================================
// The platform's exports slice (issue #91, E9.3, epic #64)
// =============================================================================
//
// `GET /api/exports/sources`, `POST /api/exports`, `GET /api/exports` and `GET /api/exports/:id`,
// the server-only job types `export.run` and `export.purge` and the daily expiry cron (which
// only enqueues). The web side is the "Download your data" card at `/settings/data-export`.
//
// TWO SOURCES, both `scope: user` and gated by `user_settings:read`:
//
//   user-data      the platform's: the caller's own rows of every user-owned model the registry
//                  (`app-registrations/user-owned-models.ts`) marks `export: 'include'` (media
//                  folders, custom secret types);
//   vault-secrets  this app's (`vault-secrets.source.ts`): secret METADATA only.
//
// SECRET VALUES NEVER TAKE THIS PATH. `Secret` and `SecretVersion` are `export: 'exclude'`; the
// values leave only through Vault's password-protected zip (`POST /api/secrets/export`), which the
// page explains and links to. `test/export/platform-export-secrets.db.spec.ts` plants markers in a
// decrypted value and in the ciphertext and proves neither reaches any writer's output.
//
// `org-data` (an organization's rows, for `org_members:read`) is the platform's default and is left
// on: no Vault model is org-kind apart from the platform's, so it carries no secret.
//
// `datamodel` is the generated client's runtime datamodel. The module is NOT global.
// =============================================================================

export const exportsModule = ExportsModule.forRoot({
  imports: [ExportsHostModule],
  datamodel: Prisma.dmmf.datamodel,
  appSlug: APP_SLUG,
});

registerExportSource(VAULT_SECRETS_EXPORT_SOURCE);
