// Registrations first: the platform registries freeze when the application bootstraps.
import './registrations';

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';
import { PLATFORM_PRISMA, PlatformHostModule, RegistryFreezeService, definePlatformHost } from '@marinoscar/platform-api/core';
import { DoctorModule } from '@marinoscar/platform-api/doctor';
import { AppMetricsService, EVENT_BUS, PlatformHostCoreModule } from '@marinoscar/platform-api/host';
import {
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  Auth,
  IdentityModule,
  Public,
  USER_DEFAULTS,
  identityConfiguration,
} from '@marinoscar/platform-api/identity';
import { JOBS_EVENT_BUS, JOBS_METRICS, JobsModule, jobsConfiguration } from '@marinoscar/platform-api/jobs';
import { NodeCredentialModule, NodeCredentialService } from '@marinoscar/platform-api/nodes';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES, SettingsModule } from '@marinoscar/platform-api/settings';
import { VaultApiModule } from '@marinoscar/vault-api';

import { BetaNotesController } from './beta-notes.controller';
import { HOST_APP_URL, HOST_IDENTITY, HOST_SLUG } from './host-identity';
import {
  HostProfileImages,
  HostUserDefaults,
  IdentityJobsAdapter,
  LoggingIdentityNotifier,
  PrismaAuditSink,
  SettingsDataAdapter,
  SystemSettingsStoreAdapter,
} from './platform-adapters';
import { PrismaModule, PrismaService } from './prisma.service';
import {
  HostBetaAudit,
  HostBetaCipher,
  HostBetaJobs,
  HostBetaMetrics,
  HostBetaNoAiModule,
  HostBetaNotifier,
  HostBetaObjects,
  HostBetaObjectStore,
  HostBetaVaultAdaptersModule,
  HostBetaVaultSettings,
  hostBetaAi,
  hostBetaAiConfig,
  hostBetaAiKeyPresence,
  hostBetaHostConfig,
} from './vault-bindings';

const PORTS = [
  { provide: PLATFORM_PRISMA, useExisting: PrismaService },
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: HostProfileImages },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: HostProfileImages },
  { provide: IDENTITY_NOTIFIER, useClass: LoggingIdentityNotifier },
  { provide: USER_DEFAULTS, useClass: HostUserDefaults },
  { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
  { provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService },
  { provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: IDENTITY_METRICS, useExisting: AppMetricsService },
  { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: JOBS_METRICS, useExisting: AppMetricsService },
];

/** The platform slices' host ports, global (a guard is built in every module that uses `@Auth()`). */
@Global()
@Module({ providers: PORTS, exports: PORTS.map((port) => port.provide) })
class HostPortsModule {}

/** Host Beta's configuration tree: the platform slices' keys plus the host's own. */
const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'test',
  appUrl: HOST_APP_URL,
  ...identityConfiguration(process.env),
  ...jobsConfiguration(process.env),
});

/** The queue, built BEFORE `SettingsModule.forRoot()` (it registers the `jobs` settings namespaces). */
const jobsModule = JobsModule.forRoot({ appName: HOST_IDENTITY.productName, imports: [HostPortsModule] });

/** The Vault domain, mounted with Host Beta's bindings for every port. */
export const vaultApiModule = VaultApiModule.forRoot({
  imports: [HostBetaVaultAdaptersModule, HostBetaNoAiModule],
  bindings: {
    prisma: { useExisting: PrismaService },
    crypto: { useFactory: () => new HostBetaCipher(process.env.HOST_BETA_DATA_KEYS ?? '') },
    objectStore: { useExisting: HostBetaObjectStore },
    objects: { useExisting: HostBetaObjects },
    jobs: { useExisting: HostBetaJobs },
    notify: { useExisting: HostBetaNotifier },
    ai: { useValue: hostBetaAi },
    aiConfig: { useValue: hostBetaAiConfig },
    aiKeyPresence: { useValue: hostBetaAiKeyPresence },
    audit: { useExisting: HostBetaAudit },
    settings: { useExisting: HostBetaVaultSettings },
    metrics: { useExisting: HostBetaMetrics },
    mcp: { useValue: { appUrl: HOST_APP_URL } },
    host: { useValue: hostBetaHostConfig },
  },
});

/** How a packaged platform route gets the host's access rules (the Doctor's). */
const platformHost = definePlatformHost({
  access: {
    requirePermissions: (permissions) => Auth({ permissions: [...permissions] as never }),
    requireAuthenticated: () => Auth(),
    allowPublic: () => Public(),
  },
});

/** Host Beta's own feature: one page. */
@Module({ controllers: [BetaNotesController] })
class BetaNotesModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    PlatformHostCoreModule.forRoot(),
    IdentityModule.forRoot({ imports: [HostPortsModule] }),
    SettingsModule.forRoot({ imports: [HostPortsModule] }),
    NodeCredentialModule,
    jobsModule,
    DoctorModule.forRoot({ host: platformHost, supportBundle: { appSlug: HOST_SLUG } }),
    PlatformHostModule.forRoot({
      audit: { useClass: PrismaAuditSink },
      settings: { useClass: SystemSettingsStoreAdapter },
      prisma: { useExisting: PrismaService },
    }),
    vaultApiModule,
    BetaNotesModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }, RegistryFreezeService],
})
export class HostBetaAppModule {}
