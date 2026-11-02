/** The fields of a backup run the retention picker looks at. */
export interface RetentionCandidate {
  id: string;
  status: string;
  startedAt: Date;
  deletedAt: Date | null;
  storageKey: string | null;
}

/**
 * Pick the backups to delete so that only the newest `keepCount` successful,
 * not-yet-deleted backups remain.
 *
 * Only `succeeded` runs that still have an object (`storageKey` set,
 * `deletedAt` null) count and can be picked; failed, running and already
 * deleted runs are ignored. The run named by `protectedRunId` (the one just
 * written) is never picked, whatever its position. Pure, so it is unit tested
 * without a database.
 *
 * @returns the runs to delete, oldest last (input order irrelevant).
 */
export function pickRunsToDelete<T extends RetentionCandidate>(
  runs: readonly T[],
  keepCount: number,
  protectedRunId?: string | null,
): T[] {
  const keep = Math.max(1, Math.floor(Number.isFinite(keepCount) ? keepCount : 1));

  const live = runs
    .filter((run) => run.status === 'succeeded' && !run.deletedAt && !!run.storageKey)
    .slice()
    .sort((a, b) => {
      const diff = b.startedAt.getTime() - a.startedAt.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

  // The protected run always survives and takes one of the kept places.
  const protectedRun = protectedRunId ? live.find((run) => run.id === protectedRunId) : undefined;
  const others = live.filter((run) => run !== protectedRun);
  const othersToKeep = protectedRun ? keep - 1 : keep;

  return others.slice(Math.max(0, othersToKeep));
}
