import { pickRunsToDelete, RetentionCandidate } from './backup-retention';

const run = (id: string, day: number, over: Partial<RetentionCandidate> = {}): RetentionCandidate => ({
  id,
  status: 'succeeded',
  startedAt: new Date(Date.UTC(2026, 0, day)),
  deletedAt: null,
  storageKey: `system-backups/${id}.zip`,
  ...over,
});

const ids = (runs: RetentionCandidate[]) => runs.map((r) => r.id).sort();

describe('pickRunsToDelete', () => {
  it('keeps the newest keepCount successful backups and picks the rest', () => {
    const runs = [run('a', 1), run('b', 2), run('c', 3), run('d', 4), run('e', 5)];
    expect(ids(pickRunsToDelete(runs, 3, 'e'))).toEqual(['a', 'b']);
  });

  it('does not depend on input order', () => {
    const runs = [run('c', 3), run('a', 1), run('e', 5), run('b', 2), run('d', 4)];
    expect(ids(pickRunsToDelete(runs, 2, 'e'))).toEqual(['a', 'b', 'c']);
  });

  it('picks nothing when there are not more than keepCount', () => {
    expect(pickRunsToDelete([run('a', 1), run('b', 2)], 2, 'b')).toEqual([]);
    expect(pickRunsToDelete([], 7, 'x')).toEqual([]);
  });

  it('ignores failed, running, already deleted and key-less runs', () => {
    const runs = [
      run('ok1', 1),
      run('ok2', 2),
      run('failed', 3, { status: 'failed' }),
      run('running', 4, { status: 'running' }),
      run('gone', 5, { deletedAt: new Date() }),
      run('nokey', 6, { storageKey: null }),
      run('ok3', 7),
    ];
    expect(ids(pickRunsToDelete(runs, 1, 'ok3'))).toEqual(['ok1', 'ok2']);
  });

  it('never picks the run just written, even if it is not the newest by start time', () => {
    // A manual run that started earlier finished after a newer one.
    const runs = [run('justWritten', 1), run('b', 2), run('c', 3)];
    const picked = pickRunsToDelete(runs, 1, 'justWritten');
    expect(ids(picked)).toEqual(['b', 'c']);
    expect(picked.find((r) => r.id === 'justWritten')).toBeUndefined();
  });

  it('treats keepCount below 1 as 1', () => {
    expect(ids(pickRunsToDelete([run('a', 1), run('b', 2)], 0, 'b'))).toEqual(['a']);
  });

  it('works without a protected id', () => {
    expect(ids(pickRunsToDelete([run('a', 1), run('b', 2), run('c', 3)], 2))).toEqual(['a']);
  });
});
