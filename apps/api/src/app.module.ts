// Fills core's role, permission, user-owned-model and model-ownership registries
// (issue #77). Before anything that reads them (the guards, the seed catalog,
// the OpenAPI RBAC docs); the registries freeze when the application bootstraps.
// Imported here too so a test that builds `AppModule` without `test/setup.ts`
// still has them registered.
import './app-registrations/registrations';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { SecretTypesModule } from './secret-types/secret-types.module';
import { SecretsModule } from './secrets/secrets.module';
import { MediaModule } from './media/media.module';
import { AiModule } from './ai/ai.module';
import { BackupsModule } from './backups/backups.module';
import { CardExpiryModule } from './card-expiry/card-expiry.module';
import { LoggerModule } from './common/logger/logger.module';

// MUST precede `settings.config`: the jobs and nodes slices ensure the `jobs`,
// `retention` and `nodes` system-settings namespaces, which the platform refuses
// once `SettingsModule.forRoot()` has composed the request bodies.
import { jobsModule, nodesModule } from './platform/jobs/jobs.config';
import { StorageConfigModule, storageModule } from './platform/storage/storage.config';
import { StorageEnvImportModule } from './platform/storage/storage-env-import.module';
import { emailModule } from './platform/email/email.config';
import { notificationsModule, BroadcastsModule } from './platform/notifications/notifications.config';
import { identityModule } from './platform/identity/identity.config';
import { platformHostModule } from './platform/platform-host.module';
import { settingsModule } from './platform/settings/settings.config';
import { hostCoreModule } from './platform/host-core.config';
import { aboutModule } from './platform/about/about.config';
import { exportsModule } from './platform/exports/exports.config';
import { userDataModule } from './platform/user-data/user-data.config';
import { onboardingModule } from './platform/onboarding/onboarding.config';
import { doctorModule } from './doctor/doctor.config';
import { DoctorChecksModule } from './doctor/doctor-checks.module';

import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling (must be at root level for NestJS 11)
    ScheduleModule.forRoot(),

    // Event emitter for async events. STAYS: the legacy auth service and the
    // `@OnEvent` handlers run on it (the platform event bus is separate).
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // Platform host ports (AUDIT_SINK, PLATFORM_PRISMA, SYSTEM_SETTINGS_STORE)
    platformHostModule,

    // Logger
    LoggerModule,

    // Feature modules
    CommonModule,
    // Identity (issue #77, E3.2): sign-in, sessions, users, roles, the allowlist,
    // PATs, the device flow and the test login, from the platform slice.
    identityModule,
    // Settings (issue #79, E4.1): /api/system-settings, /api/user-settings and
    // /api/org-settings from the platform slice. GLOBAL: SystemSettingsService,
    // UserSettingsService and SettingsResolver resolve everywhere.
    settingsModule,
    // Jobs (issue #81, E5.1): the queue, the worker pool, the lease reaper, the
    // history purge and `/api/admin/jobs/*`. GLOBAL: `JobsService` and the handler
    // registry resolve everywhere (identity's cleanup handlers register on it).
    jobsModule,
    // Worker nodes (E5.1): `/api/nodes/*`, `/api/admin/nodes/*`, the fleet sweep and
    // prune and the brokered-secret sweep. Needs `jobsModule` in the same app.
    nodesModule,
    // Email (issue #85, E7.1): SES and SMTP transports, `GET|PUT /api/email-settings`,
    // `POST /api/email-settings/test`, the template registry and layout (Vault's
    // teal and logo) and the Doctor check. NOT global: a module that sends mail imports
    // the same `emailModule` object. Runtime-configured: no SMTP or SES variable.
    emailModule,
    // Notifications (E7.1): the dispatcher (`NotificationsService`), the email, in-app
    // (inbox and SSE) and Web Push channels, `/api/notifications/*`,
    // `/api/admin/push-config/*`, the VAPID Doctor check and the retention jobs.
    // GLOBAL. Events are registered by `platform/notifications/notification.manifest.ts`.
    notificationsModule,
    // Admin broadcasts (E7.1): `/api/admin/broadcasts/*` and the two broadcast job handlers.
    BroadcastsModule,
    // Host core: event bus, maintenance mode (the only APP_GUARD), the
    // `{ data }` envelope, request log, exception filter, request ids and
    // /api/health. Placed where the health routes sat in the OpenAPI document.
    hostCoreModule,
    // Doctor (/api/admin/doctor), About (/api/admin/about) and Vault's checks
    doctorModule,
    DoctorChecksModule,
    aboutModule,
    // Storage (issue #84, E6.1): the objects API, the stale-upload sweep, the processor job and
    // the admin storage configuration from the platform slice. Runtime-configured (no env vars).
    storageModule,
    StorageConfigModule,
    StorageEnvImportModule,
    SecretTypesModule,
    SecretsModule,
    MediaModule,
    AiModule,
    BackupsModule,
    CardExpiryModule,
    // Exports (issue #91, E9.3): `GET /api/exports/sources`, `POST|GET /api/exports`, the server-only
    // `export.run` / `export.purge` jobs and the expiry cron. Sources: the platform's `user-data` and
    // Vault's `vault-secrets` (secret METADATA only; values stay in the password-protected zip).
    exportsModule,
    // User data (E9.3): the per-user Danger Zone (`/api/user-data/*`, `user.data.purge`), the admin
    // factory reset (`/api/admin/factory-reset/*`, `system:factory_reset`) and offboarding routes.
    userDataModule,
    // Onboarding (E9.3): `GET /api/onboarding`, `GET /api/admin/onboarding/metrics`.
    onboardingModule,
  ],
  providers: [
    // Global validation pipe (Zod)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // No APP_GUARD, APP_FILTER or APP_INTERCEPTOR here: the host core
    // (PlatformHostCoreModule) registers the maintenance guard, the exception
    // filter, the request log and the `{ data }` envelope.
  ],
})
export class AppModule {}
