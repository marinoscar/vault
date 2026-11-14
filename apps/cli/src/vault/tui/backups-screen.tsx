import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState, type ReactNode } from 'react';
import type { TuiScreenProps } from '@marinoscar/platform-cli/tui';

import { getCurrentUser } from '../lib/api-client.js';
import type { MenuUserState } from '../lib/admin-backups.js';
import { collectBackupStatus, type BackupStatus } from '../lib/backup-status.js';
import { hasStoredToken } from '../utils/config.js';
import {
  actionForKey,
  dashboardActions,
  dashboardCards,
  footerHints,
  recentRunRows,
  sortIssues,
  truncate,
  type DashboardAction,
} from './backups-logic.js';
import { AdminView } from './backups-admin.js';
import { ListView } from './backups-list.js';
import { RunView } from './backups-run.js';
import { ScheduleView } from './backups-schedule.js';
import { SetupView } from './backups-setup.js';
import { CardGrid, ErrorLine, Frame, Issues, Loading, SectionTitle, useColumns, useMounted } from './ui.js';

// =============================================================================
// TUI: "Backups" (route `backups`)
// =============================================================================
//
// A dashboard (last backup, next scheduled run, backups on disk, token expiry,
// recent runs, warnings) and its actions: run now, set up, schedule (installs a
// crontab entry), list and clean up, and server backups for administrators.
// Logic lives in backups-logic.ts and lib/; the views only render.
// =============================================================================

type View = Exclude<DashboardAction, 'refresh' | 'back'> | 'dashboard';

/** The signed-in user's permissions, without holding the screen up for more than 5 s. */
async function loadUserState(): Promise<MenuUserState> {
  if (!hasStoredToken()) return { kind: 'signed-out' };
  try {
    const user = await Promise.race([
      getCurrentUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000).unref()),
    ]);
    return { kind: 'signed-in', permissions: user.permissions ?? [] };
  } catch {
    return { kind: 'unknown' };
  }
}

export function BackupsScreen({ onDone }: TuiScreenProps): ReactNode {
  const [view, setView] = useState<View>('dashboard');
  const [reload, setReload] = useState(0);
  const back = (): void => {
    setView('dashboard');
    setReload((n) => n + 1);
  };
  switch (view) {
    case 'run':
      return <RunView onBack={back} />;
    case 'setup':
      return <SetupView onBack={back} />;
    case 'schedule':
      return <ScheduleView onBack={back} onSetup={() => setView('setup')} />;
    case 'list':
      return <ListView onBack={back} />;
    case 'admin':
      return <AdminView onBack={back} />;
    default:
      return <Dashboard key={reload} onDone={onDone} onOpen={setView} onRefresh={() => setReload((n) => n + 1)} />;
  }
}

function Dashboard({ onDone, onOpen, onRefresh }: { onDone: () => void; onOpen: (v: View) => void; onRefresh: () => void }): ReactNode {
  const [status, setStatus] = useState<BackupStatus | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [user, setUser] = useState<MenuUserState>({ kind: hasStoredToken() ? 'unknown' : 'signed-out' });
  const [userKnown, setUserKnown] = useState(false);
  const mounted = useMounted();
  const cols = useColumns();
  const signedIn = hasStoredToken();

  useEffect(() => {
    void collectBackupStatus()
      .then((s) => mounted.current && setStatus(s))
      .catch((err: unknown) => mounted.current && setError(err instanceof Error ? err.message : String(err)));
    void loadUserState().then((u) => {
      if (!mounted.current) return;
      setUser(u);
      setUserKnown(true);
    });
  }, []);

  const actions = dashboardActions({ signedIn, user: userKnown ? user : { kind: 'signed-in', permissions: [] } });
  const choose = (a: DashboardAction): void => {
    if (a === 'back') onDone();
    else if (a === 'refresh') onRefresh();
    else onOpen(a);
  };

  useInput((input, key) => {
    if (key.escape) return onDone();
    const a = actionForKey(input, actions);
    if (a) choose(a);
  });

  const title = 'Backups';
  if (error) {
    return (
      <Frame title={title} hints={['esc back']}>
        <ErrorLine message={error} />
      </Frame>
    );
  }
  if (!status) {
    return (
      <Frame title={title} hints={['esc back']}>
        <Loading label="Reading backup history, schedule and files…" />
      </Frame>
    );
  }

  const now = new Date(status.generatedAt);
  const rows = recentRunRows(status.runs.recent, now, 5);
  const issues = sortIssues(status.issues);
  const detailWidth = Math.max(16, cols - 50);

  return (
    <Frame title={title} hints={footerHints(actions).concat(['↑↓ enter'])}>
      <Box flexDirection="column" gap={1}>
        {!signedIn ? (
          <Box borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text color="yellow">Not signed in. Choose Login from the menu to run backups; local settings and files are shown below.</Text>
          </Box>
        ) : null}
        <CardGrid cards={dashboardCards(status, now)} />

        <Box flexDirection="column">
          <SectionTitle>Recent runs</SectionTitle>
          {rows.length === 0 ? (
            <Text dimColor>No runs recorded yet. Runs from this screen, vault backup and the schedule appear here.</Text>
          ) : (
            rows.map((r, i) =>
              cols < 70 ? (
                <Box key={i} flexDirection="column">
                  <Text>
                    <Text color={r.tone}>{r.mark}</Text> {r.when} <Text dimColor>· {r.ago} · {r.trigger}</Text>
                  </Text>
                  <Text {...(r.tone === 'red' ? { color: 'red' } : { dimColor: true })} wrap="truncate-end">
                    {'  '}
                    {r.detail}
                  </Text>
                </Box>
              ) : (
                <Box key={i} gap={1}>
                  <Text color={r.tone}>{r.mark}</Text>
                  <Text>{r.when}</Text>
                  <Text dimColor>{r.ago.padStart(11)}</Text>
                  <Text dimColor>{r.trigger.padEnd(8)}</Text>
                  <Text {...(r.tone === 'red' ? { color: 'red' } : { dimColor: true })}>{truncate(r.detail, detailWidth)}</Text>
                </Box>
              ),
            )
          )}
        </Box>

        {issues.length ? (
          <Box flexDirection="column">
            <SectionTitle>Needs attention</SectionTitle>
            <Issues issues={issues} />
          </Box>
        ) : (
          <Text color="green">✔ Nothing needs attention.</Text>
        )}

        <SelectInput
          items={actions.map((a) => ({ key: a.key, label: `${a.label}  `, value: a.value }))}
          onSelect={(item) => choose(item.value)}
        />
      </Box>
    </Frame>
  );
}
