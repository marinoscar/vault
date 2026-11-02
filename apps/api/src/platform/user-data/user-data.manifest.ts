import type { Prisma } from '@prisma/client';
import {
  registerPlatformUserData,
  registerUserDataCategory,
  registerUserDataModels,
  registerUserDataScope,
} from '@marinoscar/platform-api/user-data';

import { registerVaultFactoryResetSteps } from './factory-reset.steps';
import {
  VAULT_BACKUPS_SCOPE_CONFIRMATION,
  VAULT_BACKUPS_SCOPE_ID,
  VAULT_USER_DATA_CATEGORIES,
  VAULT_USER_DATA_PURGE_JOB_TYPE,
} from './user-data.constants';

// =============================================================================
// This app's registrations on the platform user-data slice (issue #91, E9.3, epic #64)
// =============================================================================
//
// The platform owns `/api/user-data/*`, the `user.data.purge` job, `/api/admin/factory-reset/*` and
// the Danger Zone pages. This file is everything Vault adds: its categories, one narrow scope
// and one keep-or-delete hint per owner model. The delete ORDER is the planner's (children before
// parents along the schema's relations); nothing here orders anything. IMPORTED BEFORE THE
// MODULE IS COMPOSED (`user-data.config.ts`) and before the application is created (the registries
// freeze at bootstrap).
//
// -----------------------------------------------------------------------------
// WHAT A DELETION DOES WITH EACH VAULT MODEL
// -----------------------------------------------------------------------------
//
//   Secret            DELETED inline (category `secrets`): `created_by_id` = the user. Its versions
//                     (the ciphertext) and attachments go with it by `ON DELETE CASCADE`.
//   SecretVersion     (an actor column only, no owner) goes with its secret; never a row of its own.
//   SecretAttachment  (no user column) goes with its secret. THE FILE behind an attachment is a
//                     `storage_objects` row the user uploaded, and is deleted - bytes, then row - by the
//                     platform's `files` category (`StorageObject`, `storageObjects: true`): Vault's
//                     reference counting never deletes an object another version still names, and
//                     here every version is going. The one exception is an object an administrator
//                     attached to ANOTHER user's secret (`secrets:write_any`): it is the uploader's, and
//                     deleting the uploader deletes it.
//   MediaFolder       DELETED inline (category `media`); the `media_folder_files` link rows cascade, and
//                     the files are `storage_objects` of the `files` category.
//   BackupRun         DELEGATED (category `backups`): a user's "My backups" runs, archive bytes first,
//                     by `vault.user_data.purge`. The system schedule's runs (`owner_id` null) are not
//                     a user's data.
//   SecretType        DELEGATED (category `secretTypes`): the user's CUSTOM types, only those no secret
//                     uses. System types (`is_system`, `created_by_id` null) are never touched.
//   BackupSchedule    KEPT: the one system schedule (an administrator's configuration, not a user's data).
//
// `everything` and `content` are the platform's built-in scopes, left as they are (`content` is every
// category marked `content: true`: the Vault categories below, the files, the notification inbox and AI
// history). The one narrow scope is `backups`.
//
// FACTORY RESET: the inline models go with the platform's per-user pass; `factory-reset.steps.ts`
// registers the two things it cannot reach (logical backup archives and custom secret types).
// =============================================================================

const { SECRETS, SECRET_TYPES, MEDIA, BACKUPS } = VAULT_USER_DATA_CATEGORIES;

registerUserDataCategory({
  id: SECRETS,
  label: 'Secrets',
  description:
    'Your secrets: every login, API key, card and note, all their versions and attachment records. The files attached to them are under Files.',
  content: true,
  order: 1,
});
registerUserDataCategory({
  id: SECRET_TYPES,
  label: 'Custom secret types',
  description: 'The secret types you created, unless a secret of somebody else still uses them. System types stay.',
  content: true,
  order: 2,
});
registerUserDataCategory({
  id: MEDIA,
  label: 'Media folders',
  description: 'Your media folders. The files in them are deleted with Files.',
  content: true,
  order: 3,
});
registerUserDataCategory({
  id: BACKUPS,
  label: 'My backups',
  description: 'Your saved backups: the encrypted archive files and their records.',
  content: true,
  order: 4,
});

registerUserDataScope({
  id: VAULT_BACKUPS_SCOPE_ID,
  label: 'My backups',
  description: 'Your saved backup archives only. Your secrets are not touched.',
  categories: [BACKUPS],
  confirmation: VAULT_BACKUPS_SCOPE_CONFIRMATION,
  layer: 'specific',
  order: 10,
});

const purgeDelegate = {
  jobType: VAULT_USER_DATA_PURGE_JOB_TYPE,
  payload: (userId: string): Record<string, unknown> => ({ userId }),
};

registerUserDataModels<Prisma.ModelName>([
  { model: 'Secret', category: SECRETS },
  { model: 'MediaFolder', category: MEDIA },
  { model: 'BackupRun', category: BACKUPS, delegate: purgeDelegate },
  { model: 'SecretType', category: SECRET_TYPES, delegate: purgeDelegate },
  {
    model: 'BackupSchedule',
    keep: 'The one system backup schedule is an administrator\'s configuration, not a user\'s data.',
    summary: 'The scheduled-backup configuration (schedule, retention and its encrypted password) and the system secret types',
  },
]);

registerVaultFactoryResetSteps();

// The platform's categories, models and factory reset steps, LAST: an entry whose id is already
// registered is skipped, so the entries above win where they overlap.
registerPlatformUserData();
