import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState, type ReactNode } from 'react';

import { retentionEnabled } from '../lib/backup-retention.js';
import { formatBytes, planBackupRetention, runPrune, type PruneOutcome } from '../lib/backup-runner.js';
import { loadBackupSettings, resolveBackupSettings, type ResolvedBackupSettings } from '../lib/backup-settings.js';
import { describeRetention } from '../interactive/logic.js';
import { fileRows, truncateMiddle, type FileRow } from './backups-logic.js';
import { ErrorLine, Frame, SectionTitle, useColumns } from './ui.js';

interface Listing {
  settings: ResolvedBackupSettings;
  root: string;
  rows: FileRow[];
  doomed: number;
  doomedBytes: number;
  totalBytes: number;
}

function load(): Listing {
  const { settings } = resolveBackupSettings({}, loadBackupSettings());
  const { root, files, plan } = planBackupRetention(settings.output, {
    ...(settings.keepDays !== undefined ? { keepDays: settings.keepDays } : {}),
    ...(settings.keepLast !== undefined ? { keepLast: settings.keepLast } : {}),
  });
  const doomed = new Set(plan.delete.map((f) => f.path));
  return {
    settings,
    root,
    rows: fileRows(root, files, doomed, Date.now()),
    doomed: plan.delete.length,
    doomedBytes: plan.delete.reduce((n, f) => n + f.size, 0),
    totalBytes: files.reduce((n, f) => n + f.size, 0),
  };
}

const MAX_ROWS = 12;

type Stage = { kind: 'list' } | { kind: 'confirm' } | { kind: 'cleaned'; outcome: PruneOutcome } | { kind: 'failed'; message: string };

export function ListView({ onBack }: { onBack: () => void }): ReactNode {
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [stage, setStage] = useState<Stage>({ kind: 'list' });
  const cols = useColumns();

  const refresh = (): void => {
    try {
      setListing(load());
    } catch (err) {
      setStage({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  };
  useEffect(refresh, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (stage.kind === 'confirm') setStage({ kind: 'list' });
      else onBack();
    }
  });

  const title = 'Backups · Files';
  if (stage.kind === 'failed') {
    return (
      <Frame title={title} hints={['esc back']}>
        <ErrorLine message={stage.message} />
      </Frame>
    );
  }
  if (!listing) {
    return (
      <Frame title={title} hints={['esc back']}>
        <Text dimColor>Scanning…</Text>
      </Frame>
    );
  }

  const nameWidth = Math.max(16, cols - 36);
  const shown = listing.rows.slice(0, MAX_ROWS);
  const table = (
    <Box flexDirection="column">
      <Text dimColor>
        {truncateMiddle(listing.settings.output, cols - 12)}  →  {truncateMiddle(listing.root, Math.max(10, cols - 20))}
      </Text>
      {listing.rows.length === 0 ? (
        <Text dimColor>No backups match the output template yet.</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>{'File'.padEnd(nameWidth)}</Text>
            <Text dimColor>{'Size'.padStart(9)}</Text>
            <Text dimColor>{'Age'.padStart(9)}</Text>
          </Box>
          {shown.map((r) => (
            <Box key={r.path}>
              <Text {...(r.doomed ? { color: 'red' } : {})}>{truncateMiddle(r.name, nameWidth - 1).padEnd(nameWidth)}</Text>
              <Text>{r.size.padStart(9)}</Text>
              <Text dimColor>{r.age.padStart(9)}</Text>
              {r.doomed ? <Text color="red"> ✖ prune</Text> : null}
            </Box>
          ))}
          {listing.rows.length > MAX_ROWS ? <Text dimColor>… and {listing.rows.length - MAX_ROWS} older</Text> : null}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {listing.rows.length} backup(s), {formatBytes(listing.totalBytes)} · retention: {describeRetention(listing.settings)}
        </Text>
      </Box>
    </Box>
  );

  if (stage.kind === 'confirm') {
    return (
      <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
        <Box flexDirection="column" gap={1}>
          {table}
          <Text color="yellow">
            Delete {listing.doomed} old backup(s) ({formatBytes(listing.doomedBytes)})? This cannot be undone.
          </Text>
          <SelectInput
            items={[
              { key: 'no', label: 'No, keep them', value: 'no' },
              { key: 'yes', label: `Yes, delete ${listing.doomed}`, value: 'yes' },
            ]}
            onSelect={(item) => {
              if (item.value !== 'yes') return setStage({ kind: 'list' });
              try {
                const s = listing.settings;
                const outcome = runPrune({
                  template: s.output,
                  ...(s.keepDays !== undefined ? { keepDays: s.keepDays } : {}),
                  ...(s.keepLast !== undefined ? { keepLast: s.keepLast } : {}),
                  dryRun: false,
                });
                refresh();
                setStage({ kind: 'cleaned', outcome });
              } catch (err) {
                setStage({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
              }
            }}
          />
        </Box>
      </Frame>
    );
  }

  const canClean = retentionEnabled(listing.settings) && listing.doomed > 0;
  const items = [
    ...(canClean ? [{ key: 'clean', label: `Clean up ${listing.doomed} old backup(s)`, value: 'clean' }] : []),
    { key: 'refresh', label: 'Refresh', value: 'refresh' },
    { key: 'back', label: 'Back', value: 'back' },
  ];
  return (
    <Frame title={title} hints={['↑↓ move', 'enter select', 'q / esc back']}>
      <Box flexDirection="column" gap={1}>
        <SectionTitle>Backups on this machine</SectionTitle>
        {table}
        {stage.kind === 'cleaned' ? (
          <Box flexDirection="column">
            <Text color="green">✔ Deleted {stage.outcome.deleted.length} backup(s); {stage.outcome.kept} kept.</Text>
            {stage.outcome.errors.map((e) => (
              <Text key={e.path} color="yellow">
                Could not delete {e.path}: {e.error}
              </Text>
            ))}
          </Box>
        ) : null}
        {!retentionEnabled(listing.settings) ? <Text dimColor>Retention is off; set keep days / keep last in Set up to clean up old backups.</Text> : null}
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'clean') setStage({ kind: 'confirm' });
            else if (item.value === 'refresh') {
              setStage({ kind: 'list' });
              refresh();
            } else onBack();
          }}
        />
      </Box>
    </Frame>
  );
}
