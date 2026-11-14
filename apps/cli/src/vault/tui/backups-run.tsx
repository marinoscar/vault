import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState, type ReactNode } from 'react';

import { executeBackup, recordFailure, type ExecuteBackupOutput } from '../lib/backup-run.js';
import { assertAuthenticated, formatBytes, resolvePassword, validatePassword } from '../lib/backup-runner.js';
import { retentionEnabled } from '../lib/backup-retention.js';
import {
  choosePasswordSource,
  describeContents,
  effectiveContents,
  loadBackupSettings,
  resolveBackupSettings,
  type BackupContents,
  type ResolvedBackupSettings,
} from '../lib/backup-settings.js';
import { formatDuration } from '../lib/backup-status.js';
import { getServerUrl } from '../utils/config.js';
import { applyProgress, finishProgress, friendlyError, initialProgress, progressBar, truncateMiddle, type RunProgress } from './backups-logic.js';
import { ErrorLine, Field, Frame, InputField, Loading, StepLine, useColumns, useMounted, useTick } from './ui.js';

type Stage =
  | { kind: 'checking' }
  | { kind: 'password'; field: 1 | 2; first: string; text: string; notice?: string; error?: string }
  | { kind: 'running' }
  | { kind: 'done'; out: ExecuteBackupOutput; ms: number }
  | { kind: 'failed'; message: string };

interface Plan {
  settings: ResolvedBackupSettings;
  contents: BackupContents;
}

export function RunView({ onBack }: { onBack: () => void }): ReactNode {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [plan, setPlan] = useState<Plan | undefined>(undefined);
  const [progress, setProgress] = useState<RunProgress>(initialProgress(false));
  const mounted = useMounted();
  const cols = useColumns();
  const tick = useTick(120, stage.kind === 'running');

  const start = (p: Plan, password: string): void => {
    setStage({ kind: 'running' });
    setProgress(initialProgress(retentionEnabled(p.settings)));
    const startedAt = Date.now();
    void executeBackup({
      settings: p.settings,
      contents: p.contents,
      password,
      overwrite: false,
      trigger: 'tui',
      onProgress: (e) => mounted.current && setProgress((prev) => applyProgress(prev, e)),
      onRetention: () => mounted.current && setProgress((prev) => applyProgress(prev, { phase: 'retention' })),
    })
      .then((out) => {
        if (!mounted.current) return;
        setProgress((prev) => finishProgress(prev, true));
        setStage({ kind: 'done', out, ms: Date.now() - startedAt });
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setProgress((prev) => finishProgress(prev, false));
        setStage({ kind: 'failed', message: friendlyError(err, getServerUrl()) });
      });
  };

  useEffect(() => {
    const startedAt = new Date();
    let p: Plan;
    try {
      const saved = loadBackupSettings();
      const { settings, sources } = resolveBackupSettings({}, saved);
      p = { settings, contents: effectiveContents(settings, sources) };
      assertAuthenticated();
      setPlan(p);
      const source = choosePasswordSource({}, saved, process.env);
      if (source.kind === 'prompt') {
        setStage({ kind: 'password', field: 1, first: '', text: '' });
        return;
      }
      void resolvePassword(source, { interactive: false, prompt: () => Promise.reject(new Error('no prompt')) })
        .then((pw) => mounted.current && start(p, pw))
        .catch((err: unknown) => {
          if (!mounted.current) return;
          setStage({
            kind: 'password',
            field: 1,
            first: '',
            text: '',
            notice: `${err instanceof Error ? err.message : String(err)}; enter the password instead.`,
          });
        });
    } catch (err) {
      recordFailure('tui', startedAt, err);
      setStage({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useInput((input, key) => {
    if (stage.kind === 'running') return;
    if (key.escape || (input === 'q' && stage.kind !== 'password')) onBack();
  });

  const title = 'Backups · Run now';

  if (stage.kind === 'checking') {
    return (
      <Frame title={title} hints={['esc back']}>
        <Loading label="Preparing…" />
      </Frame>
    );
  }

  if (stage.kind === 'password') {
    return (
      <Frame title={title} hints={['enter next', 'esc cancel']}>
        <Box flexDirection="column" gap={1}>
          {stage.notice ? <Text color="yellow" wrap="wrap">{stage.notice}</Text> : null}
          <Text wrap="wrap">
            Choose a password for this backup file (at least 6 characters). Without it the file cannot be opened; there is no recovery.
          </Text>
          <InputField
            label={stage.field === 1 ? 'Password        ' : 'Repeat password '}
            value={stage.text}
            mask="•"
            onChange={(text) => setStage({ ...stage, text, error: undefined })}
            onSubmit={(text) => {
              if (stage.field === 1) {
                const invalid = validatePassword(text);
                if (invalid) setStage({ ...stage, error: invalid });
                else setStage({ kind: 'password', field: 2, first: text, text: '', notice: stage.notice });
              } else if (text !== stage.first) {
                setStage({ kind: 'password', field: 1, first: '', text: '', notice: stage.notice, error: 'The passwords do not match; try again.' });
              } else if (plan) {
                start(plan, text);
              }
            }}
            error={stage.error}
          />
        </Box>
      </Frame>
    );
  }

  const barWidth = Math.max(10, Math.min(30, cols - 50));
  const dl =
    progress.download === 'active'
      ? `${progressBar(progress.bytes, progress.total, barWidth, tick)}  ${formatBytes(progress.bytes)}${progress.total ? ` of ${formatBytes(progress.total)}` : ''}`
      : progress.download === 'done'
        ? formatBytes(progress.bytes)
        : undefined;
  const steps = (
    <Box flexDirection="column">
      <StepLine state={progress.request} label="Request the encrypted export" detail={plan ? describeContents(plan.contents) : undefined} />
      <StepLine state={progress.download} label="Download" detail={dl} />
      <StepLine state={progress.write} label="Write the file (mode 0600)" />
      <StepLine state={progress.retention} label="Retention" detail={progress.retention === 'skipped' ? 'off' : undefined} />
    </Box>
  );

  if (stage.kind === 'running') {
    return (
      <Frame title={title} hints={['working…']}>
        {steps}
      </Frame>
    );
  }

  if (stage.kind === 'failed') {
    return (
      <Frame title={title} hints={['enter / esc back']}>
        <Box flexDirection="column" gap={1}>
          {plan ? steps : null}
          <ErrorLine message={stage.message} />
          <SelectInput items={[{ key: 'back', label: 'Back to Backups', value: 'back' }]} onSelect={onBack} />
        </Box>
      </Frame>
    );
  }

  const { result, prune } = stage.out;
  const pathWidth = Math.max(20, cols - 22);
  return (
    <Frame title={title} hints={['enter / esc back']}>
      <Box flexDirection="column" gap={1}>
        {steps}
        <Text color="green" bold>
          ✔ Backup saved in {formatDuration(stage.ms)}
        </Text>
        <Box flexDirection="column">
          <Field label="File" value={truncateMiddle(result.path, pathWidth)} />
          <Field label="Size" value={formatBytes(result.size)} />
          <Field label="Contents" value={describeContents(result)} />
          {result.includeSecrets ? <Field label="Secrets" value={result.secrets === null ? 'unknown' : String(result.secrets)} /> : null}
          {result.includeMedia ? <Field label="Media files" value={String(result.mediaFiles)} /> : null}
          {prune ? (
            'error' in prune ? (
              <Field label="Retention" value={`failed (backup kept): ${prune.error}`} color="yellow" />
            ) : (
              <Field
                label="Retention"
                value={`${prune.deleted.length ? `deleted ${prune.deleted.length} old backup(s)` : 'nothing to delete'}, ${prune.kept} kept${prune.errors.length ? `, ${prune.errors.length} could not be deleted` : ''}`}
                {...(prune.errors.length ? { color: 'yellow' } : {})}
              />
            )
          ) : null}
        </Box>
        <Text color="yellow">Keep the password safe: without it the file cannot be opened. There is no recovery.</Text>
        <SelectInput items={[{ key: 'back', label: 'Back to Backups', value: 'back' }]} onSelect={onBack} />
      </Box>
    </Frame>
  );
}
