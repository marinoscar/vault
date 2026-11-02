import { Global, Module } from '@nestjs/common';

import {
  AI_METRICS,
  AI_OBJECT_STORE,
  AI_SYSTEM_PRISMA,
  AI_TARGET_RESOLVER,
  AiCoreModule,
  DefaultAiTargetResolver,
  type AiSystemPrisma,
} from '@marinoscar/platform-api/ai';
import { forSystem } from '@marinoscar/platform-api/core';
import { AppMetricsService } from '@marinoscar/platform-api/host';

import { PrismaService } from '../../prisma/prisma.service';
import { AiObjectStoreAdapter } from './ai-object-store.adapter';
import { VaultAiTargetResolver } from './vault-ai-target-resolver';

// =============================================================================
// The AI slice's host ports (issue #87, E8.1, epic #63)
// =============================================================================
//
//   AI_SYSTEM_PRISMA    -> `forSystem(PrismaService, reason)`  the bypass client behind the
//                          two retention purges, the deployment-wide usage report and the
//                          catalogue sync's organization-less usage row. Vault has one
//                          connection pool and no second system client; the bypass is the
//                          transaction-local `app.rls_bypass` the platform sets.
//   AI_OBJECT_STORE     -> AiObjectStoreAdapter   SHIM(E6): refuses (no storage slice yet)
//   AI_METRICS          -> AppMetricsService      the host core's instruments
//   AI_TARGET_RESOLVER  -> VaultAiTargetResolver  `card_extract` runs on `ai.cardExtractModel`
//
// `@Global()` because every sub-module of the AI slice injects the ports.
// =============================================================================

@Global()
@Module({
  imports: [AiCoreModule],
  providers: [
    {
      provide: AI_SYSTEM_PRISMA,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): AiSystemPrisma => ({
        asSystem: (reason) =>
          forSystem(prisma, reason) as unknown as ReturnType<AiSystemPrisma['asSystem']>,
      }),
    },
    { provide: AI_OBJECT_STORE, useClass: AiObjectStoreAdapter },
    { provide: AI_METRICS, useExisting: AppMetricsService },
    DefaultAiTargetResolver,
    VaultAiTargetResolver,
    { provide: AI_TARGET_RESOLVER, useExisting: VaultAiTargetResolver },
  ],
  exports: [AI_SYSTEM_PRISMA, AI_OBJECT_STORE, AI_METRICS, AI_TARGET_RESOLVER],
})
export class AiHostModule {}
