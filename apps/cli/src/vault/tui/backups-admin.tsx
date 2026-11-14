import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState, type ReactNode } from 'react';

import { getAdminBackupSchedule, listAdminBackupRuns, startAdminBackupRun } from '../lib/api-client.js';
import type { AdminBackupRun, AdminBackupSchedule } from '../lib/admin-backups.js';
import { adminCall, waitForRun } from '../lib/admin-backups-runner.js';
import { getServerUrl } from '../utils/config.js';
import { adminRunRow, adminScheduleRows, elapsedText, friendlyError, truncate } from './backups-logic.js';
import { ErrorLine, Field, Frame, Loading, SectionTitle, Spinner, useColumns, useMounted } from './ui.js';

// "Server backups (admin)": the server's backup schedule and recent runs, and
// starting one now. Only offered to users with system_settings:read; a 403 is
// still mapped to the administrator message by adminCall.

type Stage =
  | { kind: 'loading' }
  | { kind: 'overview'; notice?: { tone: 'green' | 'red' | 'yellow'; text: string } }
  | { kind: 'running'; run?: AdminBackupRun; elapsedMs: number }
  | { kind: 'failed'; message: string };

const RUNS_SHOWN = 8;

export function AdminView({ onBack }: { onBack: () => void }): ReactNode {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [schedule, setSchedule] = useState<AdminBackupSchedule | undefined>(undefined);
  const [runs, setRuns] = useState<AdminBackupRun[]>([]);
  const mounted = useMounted();
  const cols = useColumns();

  const load = (notice?: { tone: 'green' | 'red' | 'yellow'; text: string }): void => {
    setStage({ kind: 'loading' });
    void Promise.all([adminCall(() => getAdminBackupSchedule()), adminCall(() => listAdminBackupRuns({ pageSize: RUNS_SHOWN }))])
      .then(([s, list]) => {
        if (!mounted.current) return;
        setSchedule(s);
        setRuns(list.items);
        setStage(notice ? { kind: 'overview', notice } : { kind: 'overview' });
      })
      .catch((err: unknown) => mounted.current && setStage({ kind: 'failed', message: friendlyError(err, getServerUrl()) }));
  };
  useEffect(() => load(), []);

  const start = (): void => {
    setStage({ kind: 'running', elapsedMs: 0 });
    void adminCall(() => startAdminBackupRun(), 'run')
      .then((run) =>
        waitForRun(run.id, {
          intervalMs: 2_000,
          onTick: (r, elapsedMs) => mounted.current && setStage({ kind: 'running', run: r, elapsedMs }),
        }),
      )
      .then((final) => {
        if (!mounted.current) return;
        load(
          final.status === 'succeeded'
            ? { tone: 'green', text: '✔ The server backup finished.' }
            : { tone: 'red', text: `✖ The server backup failed: ${final.error ?? 'unknown error'}` },
        );
      })
      .catch((err: unknown) => mounted.current && load({ tone: 'red', text: `✖ ${friendlyError(err, getServerUrl())}` }));
  };

  useInput((input, key) => {
    if (stage.kind === 'running') return;
    if (key.escape || input === 'q') onBack();
  });

  const title = 'Backups · Server (admin)';
  if (stage.kind === 'loading') {
    return (
      <Frame title={title} hints={['esc back']}>
        <Loading label="Reading the server's backup schedule and runs…" />
      </Frame>
    );
  }
  if (stage.kind === 'failed') {
    return (
      <Frame title={title} hints={['esc back']}>
        <Box flexDirection="column" gap={1}>
          <ErrorLine message={stage.message} />
          <SelectInput items={[{ key: 'back', label: 'Back', value: 'back' }]} onSelect={onBack} />
        </Box>
      </Frame>
    );
  }

  const countsWidth = Math.max(10, cols - 62);
  const runTable = (
    <Box flexDirection="column">
      <SectionTitle>Recent server runs</SectionTitle>
      {runs.length === 0 ? (
        <Text dimColor>No server backups yet.</Text>
      ) : (
        runs.map((r) => {
          const row = adminRunRow(r);
          return (
            <Box key={r.id} gap={1}>
              <Text>{row.when}</Text>
              <Text dimColor>{row.trigger.padEnd(8)}</Text>
              <Text color={row.tone}>{row.status.padEnd(10)}</Text>
              <Text>{row.size.padStart(9)}</Text>
              <Text {...(row.tone === 'red' ? { color: 'red' } : { dimColor: true })}>{truncate(row.counts, countsWidth)}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );

  if (stage.kind === 'running') {
    return (
      <Frame title={title} hints={['working…']}>
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <Spinner />
            <Text>
              Server backup {stage.run ? stage.run.status : 'queued'} · {elapsedText(stage.elapsedMs)}
            </Text>
          </Box>
          <Text dimColor>The backup runs on the server and is stored in its object storage; this screen polls until it finishes.</Text>
        </Box>
      </Frame>
    );
  }

  return (
    <Frame title={title} hints={['↑↓ move', 'enter select', 'q / esc back']}>
      <Box flexDirection="column" gap={1}>
        {schedule ? (
          <Box flexDirection="column">
            <SectionTitle>Server schedule</SectionTitle>
            {adminScheduleRows(schedule).map((r) => (
              <Field key={r.label} label={r.label} value={r.value} {...(r.tone ? { color: r.tone } : {})} />
            ))}
          </Box>
        ) : null}
        {runTable}
        {stage.notice ? <Text color={stage.notice.tone}>{stage.notice.text}</Text> : null}
        <Text dimColor>Change the server schedule or download archives with: vault admin backups …</Text>
        <SelectInput
          items={[
            { key: 'run', label: 'Start a server backup now', value: 'run' },
            { key: 'refresh', label: 'Refresh', value: 'refresh' },
            { key: 'back', label: 'Back', value: 'back' },
          ]}
          onSelect={(item) => (item.value === 'run' ? start() : item.value === 'refresh' ? load() : onBack())}
        />
      </Box>
    </Frame>
  );
}
