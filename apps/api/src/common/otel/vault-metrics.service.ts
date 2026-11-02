// =============================================================================
// Typed emitters for Vault's metrics (issue #90, E9.2)
// =============================================================================
//
// One method per instrument, each taking only the enumerated label values. Call
// sites pass NO identifier: there is no parameter that could carry a user id, a
// secret name or an object key. Every method is fire-and-forget and never throws
// (the host's metrics service swallows a failed recording), so instrumentation
// cannot fail a request; emit AFTER the write commits.
//
// Injected by property (`@Optional() @Inject(VaultMetricsService)`) where a
// service's constructor is shared with concurrent work, so a unit test that builds
// the service by hand keeps working with metrics off.
// =============================================================================

import { Global, Injectable, Module } from '@nestjs/common';
import { AppMetricsService } from '@marinoscar/platform-api/host';

import type { SecretTypeKind, SecretVersionSource } from './vault-metrics';

export type BackupScope = 'system' | 'user';
export type BackupTrigger = 'schedule' | 'manual';
export type BackupOutcome = 'succeeded' | 'failed';

@Injectable()
export class VaultMetricsService {
  constructor(private readonly metrics: AppMetricsService) {}

  secretCreated(typeKind: SecretTypeKind): void {
    this.metrics.add('vaultSecretsCreated', 1, { type_kind: typeKind });
  }

  secretVersionCreated(source: SecretVersionSource): void {
    this.metrics.add('vaultSecretVersionsCreated', 1, { source });
  }

  /** One finished backup run: the counter and the duration histogram, same labels. */
  backupFinished(run: { scope: BackupScope; trigger: BackupTrigger; outcome: BackupOutcome; durationMs: number }): void {
    const labels = { scope: run.scope, trigger: run.trigger, outcome: run.outcome };
    this.metrics.add('vaultBackupRuns', 1, labels);
    this.metrics.record('vaultBackupDuration', Math.max(0, run.durationMs) / 1000, labels);
  }

  cardExtracted(outcome: string): void {
    this.metrics.add('vaultCardExtractions', 1, { outcome });
  }
}

@Global()
@Module({
  providers: [VaultMetricsService],
  exports: [VaultMetricsService],
})
export class VaultMetricsModule {}
