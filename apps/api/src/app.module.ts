import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { AllowlistModule } from './allowlist/allowlist.module';
import { DeviceAuthModule } from './device-auth/device-auth.module';
import { StorageModule } from './storage/storage.module';
import { PatModule } from './pat/pat.module';
import { SecretTypesModule } from './secret-types/secret-types.module';
import { SecretsModule } from './secrets/secrets.module';
import { MediaModule } from './media/media.module';
import { AiModule } from './ai/ai.module';
import { BackupsModule } from './backups/backups.module';
import { LoggerModule } from './common/logger/logger.module';
import { TestAuthModule } from './test-auth/test-auth.module';

import { platformHostModule } from './platform/platform-host.module';
import { SystemSettingsShimModule } from './platform/system-settings.shim';
import { hostCoreModule } from './platform/host-core.config';
import { aboutModule } from './platform/about/about.config';
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
    // PLATFORM-ADOPTION-SHIM(E4.1): the platform SystemSettingsService token
    SystemSettingsShimModule,

    // Logger
    LoggerModule,

    // Feature modules
    CommonModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    // Host core: event bus, maintenance mode (the only APP_GUARD), the
    // `{ data }` envelope, request log, exception filter, request ids and
    // /api/health. Placed where the health routes sat in the OpenAPI document.
    hostCoreModule,
    // Doctor (/api/admin/doctor), About (/api/admin/about) and Vault's checks
    doctorModule,
    DoctorChecksModule,
    aboutModule,
    AllowlistModule,
    DeviceAuthModule,
    StorageModule,
    PatModule,
    SecretTypesModule,
    SecretsModule,
    MediaModule,
    AiModule,
    BackupsModule,

    // Test modules (non-production only)
    ...(process.env.NODE_ENV !== 'production' ? [TestAuthModule] : []),
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
