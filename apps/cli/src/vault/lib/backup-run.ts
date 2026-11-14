// =============================================================================
// One backup run with retention and a history record
// =============================================================================
//
// Shared by `vault backup` and the TUI's "Run backup now": download the backup
// (performBackup), run retention when it is on (never failing the run), and
// append one record to backup.log (see backup-status.ts). A failure is recorded
// too, then re-thrown.
// =============================================================================

import { retentionEnabled } from './backup-retention.js';
import { performBackup, runPrune, type BackupResult, type PerformBackupInput, type PruneOutcome } from './backup-runner.js';
import { appendRunRecord, makeRunRecord, type RunTrigger } from './backup-status.js';

export type PruneMode = 'auto' | 'skip' | 'dry-run';

export interface ExecuteBackupInput extends PerformBackupInput {
  trigger: RunTrigger;
  prune?: PruneMode;
  /** Retention starting (for a progress display). */
  onRetention?: () => void;
  /** Override the history file (tests). */
  logFile?: string;
  startedAt?: Date;
}

export interface ExecuteBackupOutput {
  result: BackupResult;
  prune: PruneOutcome | { error: string } | null;
}

/** Record a failure that happened before or during a run (never throws). */
export function recordFailure(trigger: RunTrigger, startedAt: Date, err: unknown, logFile?: string): void {
  appendRunRecord(
    makeRunRecord({
      startedAt,
      finishedAt: new Date(),
      trigger,
      outcome: 'failure',
      error: err instanceof Error ? err.message : String(err),
    }),
    ...(logFile ? [logFile] : []),
  );
}

export async function executeBackup(input: ExecuteBackupInput): Promise<ExecuteBackupOutput> {
  const startedAt = input.startedAt ?? new Date();
  let result: BackupResult;
  try {
    result = await performBackup(input);
  } catch (err) {
    recordFailure(input.trigger, startedAt, err, input.logFile);
    throw err;
  }

  const { settings } = input;
  let prune: ExecuteBackupOutput['prune'] = null;
  const mode = input.prune ?? 'auto';
  if (mode !== 'skip' && retentionEnabled(settings)) {
    input.onRetention?.();
    try {
      prune = runPrune({
        template: settings.output,
        ...(settings.keepDays !== undefined ? { keepDays: settings.keepDays } : {}),
        ...(settings.keepLast !== undefined ? { keepLast: settings.keepLast } : {}),
        protect: [result.path],
        dryRun: mode === 'dry-run',
      });
    } catch (err) {
      prune = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  appendRunRecord(
    makeRunRecord({
      startedAt,
      finishedAt: new Date(),
      trigger: input.trigger,
      outcome: 'success',
      path: result.path,
      size: result.size,
      contents: result.contents,
      retentionDeleted: prune && !('error' in prune) ? prune.deleted.length : 0,
    }),
    ...(input.logFile ? [input.logFile] : []),
  );
  return { result, prune };
}
