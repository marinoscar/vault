import { Prisma } from '@prisma/client';
import { UserDataModule, composedSchemaDatamodel } from '@marinoscar/platform-api/user-data';

// Registers this app's categories, scope, model hints and factory reset steps, THEN the platform's.
// Must be imported before the module is composed.
import './user-data.manifest';
import { UserDataHostModule } from './user-data-host.module';

// =============================================================================
// The platform's user-data slice (issue #91, E9.3, epic #64)
// =============================================================================
//
// `GET /api/user-data/summary`, `POST /api/user-data/deletions` and the `user.data.purge` job over
// the registries `user-data.manifest.ts` fills (the per-user Danger Zone), plus the admin factory
// reset (`/api/admin/factory-reset/*`, gated on `system:factory_reset`, Admin only) and the
// organization offboarding routes (`orgs:offboard`; they answer `TENANCY_MODE=multi` only and have no
// Vault page, because Vault runs one organization). Web: `/settings/danger-zone` and
// `/admin/settings/factory-reset`.
//
// `datamodel` is the composed Prisma schema folder (`prisma/schema`), parsed once when the purge plan
// is first computed: the generated client's DMMF lacks `onDelete`, and the planner orders the deletes
// from it.
//
// `factoryReset.keepJobsReferencedBy`: the platform `db-backup` slice's runs link to their job, and a
// reset must not delete the jobs the surviving database backups point at. The entry is added only when
// the schema has that model, so this file is correct before and after the slice is mounted. Vault's
// own logical backups are deleted by the reset (`factory-reset.steps.ts`).
//
// No `userRemovalHooks`: Vault has not adopted the sharing slice (no groups to keep administrable).
// =============================================================================

const hasModel = (name: string): boolean => Prisma.dmmf.datamodel.models.some((model) => model.name === name);

export const userDataModule = UserDataModule.forRoot({
  imports: [UserDataHostModule],
  datamodel: composedSchemaDatamodel(__dirname),
  factoryReset: {
    keepJobsReferencedBy: hasModel('DatabaseBackupRun') ? [{ model: 'DatabaseBackupRun', field: 'jobId' }] : [],
  },
});
