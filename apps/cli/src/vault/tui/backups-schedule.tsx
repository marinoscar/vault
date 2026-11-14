import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState, type ReactNode } from 'react';

import {
  DEFAULT_TIME,
  getScheduleStatus,
  installSchedule,
  presetToCron,
  removeSchedule,
  schedulePreflight,
  supportsCrontab,
  type InstalledSchedule,
  type SchedulePreset,
  type ScheduleStatus,
} from '../lib/backup-schedule.js';
import { nextRun } from '../lib/cron.js';
import { DEFAULT_PASSWORD_ENV, PASSWORD_ENV_ALIAS, loadBackupSettings } from '../lib/backup-settings.js';
import { collectPreflightInput, currentCronCommand, ensureLogFile, getBackupLogPath, inTime, localStamp } from '../lib/backup-status.js';
import { buildScheduleInstructions } from '../interactive/logic.js';
import {
  PRESET_CHOICES,
  cronFieldFeedback,
  everyHoursChoices,
  parseTimeField,
  schedulePreview,
  sortIssues,
  weekdayChoices,
  type SchedulePreview,
} from './backups-logic.js';
import { ErrorLine, Field, Frame, InputField, Issues, Loading, SectionTitle, useMounted } from './ui.js';

type Stage =
  | { kind: 'loading' }
  | { kind: 'overview' }
  | { kind: 'preset' }
  | { kind: 'daily'; text: string; error?: string }
  | { kind: 'hourly' }
  | { kind: 'weekday' }
  | { kind: 'weekly-time'; day: number; text: string; error?: string }
  | { kind: 'cron'; text: string; error?: string }
  | { kind: 'preview'; preset: SchedulePreset; preview: SchedulePreview }
  | { kind: 'working'; label: string }
  | { kind: 'installed'; installed: InstalledSchedule }
  | { kind: 'remove' }
  | { kind: 'removed' }
  | { kind: 'windows'; text: string; error?: string; content?: string; steps?: string[]; warnings?: string[] }
  | { kind: 'failed'; message: string };

export function ScheduleView({ onBack, onSetup }: { onBack: () => void; onSetup: () => void }): ReactNode {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [status, setStatus] = useState<ScheduleStatus | undefined>(undefined);
  const mounted = useMounted();

  const fail = (err: unknown): void => {
    if (mounted.current) setStage({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
  };

  const load = (): void => {
    if (!supportsCrontab()) {
      setStage({ kind: 'windows', text: DEFAULT_TIME });
      return;
    }
    setStage({ kind: 'loading' });
    void getScheduleStatus()
      .then((s) => {
        if (!mounted.current) return;
        setStatus(s);
        setStage(s.error ? { kind: 'failed', message: s.error } : { kind: 'overview' });
      })
      .catch(fail);
  };
  useEffect(load, []);

  const preview = (preset: SchedulePreset): void => {
    try {
      const now = new Date();
      const command = currentCronCommand();
      // The preflight checks the token against the first run of THIS schedule.
      const issues = schedulePreflight(collectPreflightInput(nextRun(presetToCron(preset), now)));
      setStage({ kind: 'preview', preset, preview: schedulePreview(preset, command, issues, now) });
    } catch (err) {
      fail(err);
    }
  };

  const install = (p: SchedulePreview): void => {
    setStage({ kind: 'working', label: 'Writing your crontab…' });
    try {
      ensureLogFile();
    } catch (err) {
      return fail(err);
    }
    void installSchedule(p.cron, p.command)
      .then((installed) => mounted.current && setStage({ kind: 'installed', installed }))
      .catch(fail);
  };

  const remove = (): void => {
    setStage({ kind: 'working', label: 'Removing the schedule from your crontab…' });
    void removeSchedule()
      .then(() => mounted.current && setStage({ kind: 'removed' }))
      .catch(fail);
  };

  useInput((input, key) => {
    const typing = stage.kind === 'daily' || stage.kind === 'weekly-time' || stage.kind === 'cron' || stage.kind === 'windows';
    if (!key.escape && !(input === 'q' && !typing)) return;
    switch (stage.kind) {
      case 'preset':
      case 'remove':
        return setStage({ kind: 'overview' });
      case 'daily':
      case 'hourly':
      case 'weekday':
      case 'cron':
        return setStage({ kind: 'preset' });
      case 'weekly-time':
        return setStage({ kind: 'weekday' });
      case 'preview':
        return setStage({ kind: 'preset' });
      case 'working':
        return;
      default:
        return onBack();
    }
  });

  const title = 'Backups · Schedule';
  const back = ['esc back'];

  switch (stage.kind) {
    case 'loading':
      return (
        <Frame title={title} hints={back}>
          <Loading label="Reading your crontab…" />
        </Frame>
      );
    case 'working':
      return (
        <Frame title={title} hints={[]}>
          <Loading label={stage.label} />
        </Frame>
      );
    case 'failed':
      return (
        <Frame title={title} hints={back}>
          <Box flexDirection="column" gap={1}>
            <ErrorLine message={stage.message} />
            <SelectInput items={[{ key: 'back', label: 'Back', value: 'back' }]} onSelect={onBack} />
          </Box>
        </Frame>
      );
    case 'overview': {
      const installed = status?.installed ?? null;
      const issues = installed ? sortIssues(schedulePreflight(collectPreflightInput(status?.next[0]))) : [];
      const items = [
        { key: 'install', label: installed ? 'Change the schedule' : 'Schedule backups', value: 'install' },
        ...(installed ? [{ key: 'remove', label: 'Remove the schedule', value: 'remove' }] : []),
        { key: 'back', label: 'Back', value: 'back' },
      ];
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            {installed ? (
              <Box flexDirection="column">
                <Text color="green" bold>
                  ✔ {installed.description}
                </Text>
                {installed.installedAt ? <Field label="Installed" value={localStamp(installed.installedAt)} dim /> : null}
                {(status?.next ?? []).map((d, i) => (
                  <Field key={i} label={i === 0 ? 'Next runs' : ''} value={`${localStamp(d)}  (${inTime(d)})`} {...(i === 0 ? { color: 'cyan' } : {})} />
                ))}
                <Field label="Log" value={getBackupLogPath()} dim />
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text color="yellow" bold>
                  Not scheduled
                </Text>
                <Text dimColor wrap="wrap">
                  A schedule adds one marked entry to your crontab that runs "vault backup" with your saved settings. Other crontab lines are never touched.
                </Text>
              </Box>
            )}
            <Issues issues={issues} />
            <SelectInput
              items={items}
              onSelect={(item) => {
                if (item.value === 'install') setStage({ kind: 'preset' });
                else if (item.value === 'remove') setStage({ kind: 'remove' });
                else onBack();
              }}
            />
          </Box>
        </Frame>
      );
    }
    case 'preset':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text>How often should backups run? (local time)</Text>
            <SelectInput
              items={PRESET_CHOICES.map((c) => ({ key: c.key, label: c.label, value: c.value }))}
              onSelect={(item) => {
                if (item.value === 'back') setStage({ kind: 'overview' });
                else if (item.value === 'daily') setStage({ kind: 'daily', text: DEFAULT_TIME });
                else if (item.value === 'hourly') setStage({ kind: 'hourly' });
                else if (item.value === 'weekly') setStage({ kind: 'weekday' });
                else setStage({ kind: 'cron', text: '' });
              }}
            />
          </Box>
        </Frame>
      );
    case 'daily':
      return (
        <Frame title={title} hints={['enter preview', 'esc back']}>
          <InputField
            label="Every day at (HH:MM)"
            value={stage.text}
            onChange={(text) => setStage({ kind: 'daily', text })}
            onSubmit={(text) => {
              const t = parseTimeField(text);
              if (t.ok) preview({ kind: 'daily', hour: t.hour, minute: t.minute });
              else setStage({ kind: 'daily', text, error: t.error });
            }}
            error={stage.error}
          />
        </Frame>
      );
    case 'hourly':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter preview', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text>Run every…</Text>
            <SelectInput items={everyHoursChoices()} onSelect={(item) => preview({ kind: 'hourly', every: Number(item.value) })} />
          </Box>
        </Frame>
      );
    case 'weekday':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text>Which day?</Text>
            <SelectInput items={weekdayChoices()} onSelect={(item) => setStage({ kind: 'weekly-time', day: Number(item.value), text: DEFAULT_TIME })} />
          </Box>
        </Frame>
      );
    case 'weekly-time':
      return (
        <Frame title={title} hints={['enter preview', 'esc back']}>
          <InputField
            label="At (HH:MM)"
            value={stage.text}
            onChange={(text) => setStage({ ...stage, text, error: undefined })}
            onSubmit={(text) => {
              const t = parseTimeField(text);
              if (t.ok) preview({ kind: 'weekly', day: stage.day, hour: t.hour, minute: t.minute });
              else setStage({ ...stage, text, error: t.error });
            }}
            error={stage.error}
          />
        </Frame>
      );
    case 'cron': {
      const fb = cronFieldFeedback(stage.text, new Date());
      return (
        <Frame title={title} hints={['enter preview', 'esc back']}>
          <InputField
            label="Cron expression"
            value={stage.text}
            placeholder="30 2 * * 1-5"
            onChange={(text) => setStage({ kind: 'cron', text })}
            onSubmit={(text) => {
              const f = cronFieldFeedback(text, new Date());
              if (f.ok) preview({ kind: 'cron', expression: text });
              else setStage({ kind: 'cron', text, error: f.error });
            }}
            help={fb.ok ? <Text color="green">{fb.description} · next {fb.next}</Text> : <Text dimColor>{fb.error}</Text>}
            error={stage.error}
          />
        </Frame>
      );
    }
    case 'preview': {
      const p = stage.preview;
      const replacing = Boolean(status?.installed);
      const items = p.blocking
        ? [
            { key: 'setup', label: 'Fix it in Set up first', value: 'setup' },
            { key: 'install', label: 'Install anyway', value: 'install' },
            { key: 'back', label: 'Back', value: 'back' },
          ]
        : [
            { key: 'install', label: replacing ? 'Replace the schedule' : 'Install the schedule', value: 'install' },
            { key: 'back', label: 'Back', value: 'back' },
          ];
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text bold color="cyan">
              {p.description}
            </Text>
            <Box flexDirection="column">
              {p.next.map((n, i) => (
                <Field key={i} label={i === 0 ? 'Next runs' : ''} value={n} {...(i === 0 ? { color: 'cyan' } : {})} />
              ))}
            </Box>
            <Box flexDirection="column">
              <SectionTitle>Crontab line</SectionTitle>
              <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Text wrap="wrap">{p.line}</Text>
              </Box>
            </Box>
            {p.issues.length ? <Issues issues={p.issues} /> : <Text color="green">✔ Preflight passed: an unattended run has everything it needs.</Text>}
            <SelectInput
              items={items}
              onSelect={(item) => {
                if (item.value === 'install') install(p);
                else if (item.value === 'setup') onSetup();
                else setStage({ kind: 'preset' });
              }}
            />
          </Box>
        </Frame>
      );
    }
    case 'installed':
      return (
        <Frame title={title} hints={['enter / esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text color="green" bold>
              ✔ Scheduled: {stage.installed.description}
            </Text>
            <Text dimColor wrap="wrap">
              Each run appends a record to {getBackupLogPath()}; the Backups dashboard and "vault backup status" read it.
            </Text>
            <SelectInput items={[{ key: 'back', label: 'Back to Backups', value: 'back' }]} onSelect={onBack} />
          </Box>
        </Frame>
      );
    case 'remove':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <Text color="yellow">Remove the scheduled backup ({status?.installed?.description})? Other crontab lines stay.</Text>
            <SelectInput
              items={[
                { key: 'no', label: 'No, keep it', value: 'no' },
                { key: 'yes', label: 'Yes, remove it', value: 'yes' },
              ]}
              onSelect={(item) => (item.value === 'yes' ? remove() : setStage({ kind: 'overview' }))}
            />
          </Box>
        </Frame>
      );
    case 'removed':
      return (
        <Frame title={title} hints={['enter / esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text color="green">✔ The scheduled backup was removed from your crontab.</Text>
            <SelectInput items={[{ key: 'back', label: 'Back to Backups', value: 'back' }]} onSelect={onBack} />
          </Box>
        </Frame>
      );
    case 'windows':
      return (
        <Frame title={title} hints={['enter show', 'esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text wrap="wrap">This system has no crontab; the entry for Windows Task Scheduler is shown for you to add.</Text>
            <InputField
              label="Every day at (HH:MM)"
              value={stage.text}
              onChange={(text) => setStage({ kind: 'windows', text })}
              onSubmit={(text) => {
                const t = parseTimeField(text);
                if (!t.ok) return setStage({ kind: 'windows', text, error: t.error });
                const env: Record<string, string> = {};
                for (const k of ['VAULT_CONFIG_DIR', 'VAULTCLI_CONFIG_DIR', 'VAULT_SERVER_URL', 'VAULTCLI_SERVER_URL']) {
                  const v = process.env[k];
                  if (v) env[k] = v;
                }
                const ins = buildScheduleInstructions({
                  platform: process.platform,
                  nodePath: process.execPath,
                  cliPath: process.argv[1] ?? 'vault',
                  hour: t.hour,
                  minute: t.minute,
                  env,
                  logPath: getBackupLogPath(),
                  homeDir: homedir(),
                  saved: loadBackupSettings(),
                  defaultEnvSet: Boolean(process.env[DEFAULT_PASSWORD_ENV] || process.env[PASSWORD_ENV_ALIAS]),
                });
                setStage({ kind: 'windows', text, content: ins.content, steps: ins.steps, warnings: ins.warnings });
              }}
              error={stage.error}
            />
            {stage.content ? (
              <Box flexDirection="column">
                {stage.steps?.map((s, i) => <Text key={i}>{`${i + 1}. ${s}`}</Text>)}
                <Box borderStyle="single" borderColor="gray" paddingX={1}>
                  <Text wrap="wrap">{stage.content}</Text>
                </Box>
                <Issues issues={(stage.warnings ?? []).map((message) => ({ level: 'warning' as const, message }))} />
              </Box>
            ) : null}
          </Box>
        </Frame>
      );
  }
}
