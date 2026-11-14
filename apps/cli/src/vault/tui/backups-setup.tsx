import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useState, type ReactNode } from 'react';

import { validatePassword } from '../lib/backup-runner.js';
import {
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_PASSWORD_ENV,
  SUGGESTED_KEEP_DAYS,
  contentsFromKeys,
  describeContents,
  getDefaultPasswordFilePath,
  loadBackupSettings,
  resolveBackupSettings,
  saveBackupSettings,
  writePasswordFile,
  type BackupSettings,
} from '../lib/backup-settings.js';
import {
  backupContentChoices,
  describePasswordSetting,
  describeRetention,
  parseRetentionInput,
  previewTemplate,
  tokenHelp,
  validateContentSelection,
} from '../interactive/logic.js';
import { CheckboxList, ErrorLine, Field, Frame, InputField, SectionTitle } from './ui.js';

// "Set up backups", the ink version of interactive/setup-wizard.ts. It writes
// backup.json through the settings lib; the password itself only ever goes to
// the 0600 password file (writePasswordFile), never to backup.json.

const SUGGESTED_TEMPLATE = '~/vault-backups/vault-backup-{datetime}.zip';

type PwChoice = 'create' | 'file' | 'env' | 'ask';

type Step =
  | { kind: 'utc' }
  | { kind: 'output'; text: string; error?: string }
  | { kind: 'source' }
  | { kind: 'replace' }
  | { kind: 'pw'; field: 1 | 2; first: string; text: string; error?: string }
  | { kind: 'file'; text: string; error?: string }
  | { kind: 'env'; text: string; error?: string }
  | { kind: 'contents' }
  | { kind: 'days'; text: string; error?: string }
  | { kind: 'last'; text: string; error?: string }
  | { kind: 'summary'; notice?: string }
  | { kind: 'saved'; file: string; notice?: string }
  | { kind: 'failed'; message: string };

function expandHome(p: string): string {
  return resolvePath(p.replace(/^~(?=$|[\\/])/, homedir()));
}

export function SetupView({ onBack }: { onBack: () => void }): ReactNode {
  const [current] = useState<BackupSettings>(() => {
    try {
      return loadBackupSettings();
    } catch {
      return {};
    }
  });
  const [next, setNext] = useState<BackupSettings>(() => ({ ...current }));
  const [step, setStep] = useState<Step>({ kind: 'utc' });
  const [pwNotice, setPwNotice] = useState<string | undefined>(undefined);
  const defaultFile = getDefaultPasswordFilePath();
  const now = new Date();
  const previewOpts = { utc: next.utc ?? false, host: hostname(), homeDir: homedir() };

  const update = (patch: BackupSettings, drop: (keyof BackupSettings)[] = []): void => {
    setNext((prev) => {
      const n = { ...prev, ...patch };
      for (const k of drop) delete n[k];
      return n;
    });
  };

  useInput((input, key) => {
    const typing = ['output', 'pw', 'file', 'env', 'days', 'last'].includes(step.kind);
    if (key.escape || (input === 'q' && !typing && step.kind !== 'contents')) onBack();
  });

  const title = 'Backups · Set up';
  const hints = ['enter next', 'esc cancel'];

  const afterSource = (): void => setStep({ kind: 'contents' });

  switch (step.kind) {
    case 'utc':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Step 1 of 6 · Dates and times in file names</Text>
            <SelectInput
              items={[
                { key: 'local', label: 'Local time', value: 'local' },
                { key: 'utc', label: 'UTC', value: 'utc' },
              ]}
              initialIndex={current.utc ? 1 : 0}
              onSelect={(item) => {
                update({ utc: item.value === 'utc' });
                setStep({ kind: 'output', text: current.output ?? SUGGESTED_TEMPLATE });
              }}
            />
          </Box>
        </Frame>
      );
    case 'output': {
      const p = previewTemplate(step.text, now, previewOpts);
      return (
        <Frame title={title} hints={hints}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Step 2 of 6 · Where backups are written (folders are created as needed)</Text>
            <InputField
              label="File name template"
              value={step.text}
              onChange={(text) => setStep({ kind: 'output', text })}
              onSubmit={(text) => {
                const r = previewTemplate(text, now, previewOpts);
                if (!r.ok) return setStep({ kind: 'output', text, error: r.error });
                update({ output: text });
                setStep({ kind: 'source' });
              }}
              help={
                <Box flexDirection="column">
                  {p.ok ? <Text color="green">→ {resolvePath(p.path)}</Text> : <Text color="red">{p.error}</Text>}
                  <Text dimColor wrap="wrap">Tokens: {tokenHelp()}</Text>
                </Box>
              }
              error={step.error}
            />
          </Box>
        </Frame>
      );
    }
    case 'source':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Step 3 of 6 · Where backups get their password (it is never stored in backup.json)</Text>
            <SelectInput
              items={[
                { key: 'create', label: `Create a password file (${defaultFile}, mode 0600)`, value: 'create' as PwChoice },
                { key: 'file', label: 'Use an existing password file', value: 'file' as PwChoice },
                { key: 'env', label: 'Read it from an environment variable', value: 'env' as PwChoice },
                { key: 'ask', label: 'Ask every time (scheduled backups will not work)', value: 'ask' as PwChoice },
              ]}
              initialIndex={current.passwordFile ? (current.passwordFile === defaultFile ? 0 : 1) : current.passwordEnv ? 2 : 0}
              onSelect={(item) => {
                if (item.value === 'create') setStep(existsSync(defaultFile) ? { kind: 'replace' } : { kind: 'pw', field: 1, first: '', text: '' });
                else if (item.value === 'file') setStep({ kind: 'file', text: current.passwordFile ?? '' });
                else if (item.value === 'env') setStep({ kind: 'env', text: current.passwordEnv ?? DEFAULT_PASSWORD_ENV });
                else {
                  update({}, ['passwordFile', 'passwordEnv']);
                  afterSource();
                }
              }}
            />
            <Text dimColor wrap="wrap">A password file is best for scheduled backups. Anyone who can read it can open your backups.</Text>
          </Box>
        </Frame>
      );
    case 'replace':
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <Text>{defaultFile} already exists.</Text>
            <SelectInput
              items={[
                { key: 'keep', label: 'Keep the password in it', value: 'keep' },
                { key: 'replace', label: 'Replace it with a new password', value: 'replace' },
              ]}
              onSelect={(item) => {
                if (item.value === 'replace') return setStep({ kind: 'pw', field: 1, first: '', text: '' });
                update({ passwordFile: defaultFile }, ['passwordEnv']);
                afterSource();
              }}
            />
          </Box>
        </Frame>
      );
    case 'pw':
      return (
        <Frame title={title} hints={hints}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Step 3 of 6 · The password for your backups (at least 6 characters)</Text>
            <InputField
              label={step.field === 1 ? 'Password        ' : 'Repeat password '}
              value={step.text}
              mask="•"
              onChange={(text) => setStep({ ...step, text, error: undefined })}
              onSubmit={(text) => {
                if (step.field === 1) {
                  const invalid = validatePassword(text);
                  return invalid ? setStep({ ...step, error: invalid }) : setStep({ kind: 'pw', field: 2, first: text, text: '' });
                }
                if (text !== step.first) return setStep({ kind: 'pw', field: 1, first: '', text: '', error: 'The passwords do not match; try again.' });
                try {
                  writePasswordFile(defaultFile, text);
                } catch (err) {
                  return setStep({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
                }
                setPwNotice(`Saved the password file ${defaultFile} (mode 0600). Write the password down too: there is no recovery.`);
                update({ passwordFile: defaultFile }, ['passwordEnv']);
                afterSource();
              }}
              error={step.error}
            />
          </Box>
        </Frame>
      );
    case 'file':
      return (
        <Frame title={title} hints={hints}>
          <InputField
            label="Password file (first line is used)"
            value={step.text}
            onChange={(text) => setStep({ kind: 'file', text })}
            onSubmit={(text) => {
              if (!text.trim()) return setStep({ kind: 'file', text, error: 'Enter a path' });
              const abs = expandHome(text.trim());
              if (!existsSync(abs)) return setStep({ kind: 'file', text, error: `File not found: ${abs}` });
              update({ passwordFile: abs }, ['passwordEnv']);
              afterSource();
            }}
            error={step.error}
          />
        </Frame>
      );
    case 'env':
      return (
        <Frame title={title} hints={hints}>
          <InputField
            label="Environment variable"
            value={step.text}
            onChange={(text) => setStep({ kind: 'env', text })}
            onSubmit={(text) => {
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return setStep({ kind: 'env', text, error: 'Use letters, digits and _ only' });
              update({ passwordEnv: text }, ['passwordFile']);
              afterSource();
            }}
            help={<Text dimColor>Scheduled jobs do not load your shell profile; a password file is simpler for them.</Text>}
            error={step.error}
          />
        </Frame>
      );
    case 'contents': {
      const { settings } = resolveBackupSettings({}, next);
      return (
        <Frame title={title} hints={['↑↓ move', 'space toggle', 'enter next', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Step 4 of 6 · What to back up</Text>
            {pwNotice ? <Text color="green" wrap="wrap">✔ {pwNotice}</Text> : null}
            <CheckboxList
              items={backupContentChoices(settings).map((c) => ({ key: c.value, label: c.name, description: c.description, checked: c.checked }))}
              validate={(keys) => validateContentSelection(keys)}
              onSubmit={(keys) => {
                update(contentsFromKeys(keys, 'selection'));
                setStep({ kind: 'days', text: String(current.keepDays ?? SUGGESTED_KEEP_DAYS) });
              }}
            />
          </Box>
        </Frame>
      );
    }
    case 'days':
    case 'last': {
      const isDays = step.kind === 'days';
      return (
        <Frame title={title} hints={hints}>
          <Box flexDirection="column" gap={1}>
            <Text dimColor>
              Step {isDays ? 5 : 6} of 6 · Retention (after each successful backup; only files matching the template; the newest is always kept)
            </Text>
            <InputField
              label={isDays ? 'Delete backups older than N days (blank or 0 = never)' : 'Keep at most N backups (blank or 0 = no limit)'}
              value={step.text}
              onChange={(text) => setStep({ kind: step.kind, text })}
              onSubmit={(text) => {
                const r = parseRetentionInput(text);
                if (!r.ok) return setStep({ kind: step.kind, text, error: r.error });
                const key = isDays ? 'keepDays' : 'keepLast';
                if (r.value === undefined) update({}, [key]);
                else update({ [key]: r.value });
                setStep(isDays ? { kind: 'last', text: current.keepLast !== undefined ? String(current.keepLast) : '' } : { kind: 'summary' });
              }}
              error={step.error}
            />
          </Box>
        </Frame>
      );
    }
    case 'summary': {
      const p = previewTemplate(next.output ?? DEFAULT_BACKUP_SETTINGS.output, now, previewOpts);
      return (
        <Frame title={title} hints={['↑↓ move', 'enter select', 'esc cancel']}>
          <Box flexDirection="column" gap={1}>
            <SectionTitle>Summary</SectionTitle>
            <Box flexDirection="column">
              <Field label="Output" value={next.output ?? DEFAULT_BACKUP_SETTINGS.output} />
              {p.ok ? <Field label="Next file" value={resolvePath(p.path)} dim /> : null}
              <Field label="Password" value={describePasswordSetting(next, process.env)} />
              <Field label="Contents" value={describeContents(resolveBackupSettings({}, next).settings)} />
              <Field label="Time zone" value={next.utc ? 'UTC' : 'local time'} />
              <Field label="Retention" value={describeRetention(next)} />
            </Box>
            <SelectInput
              items={[
                { key: 'save', label: 'Save these settings', value: 'save' },
                { key: 'cancel', label: 'Cancel (nothing is saved)', value: 'cancel' },
              ]}
              onSelect={(item) => {
                if (item.value !== 'save') return onBack();
                try {
                  const file = saveBackupSettings(next);
                  setStep({ kind: 'saved', file });
                } catch (err) {
                  setStep({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
                }
              }}
            />
          </Box>
        </Frame>
      );
    }
    case 'saved':
      return (
        <Frame title={title} hints={['enter / esc back']}>
          <Box flexDirection="column" gap={1}>
            <Text color="green">✔ Saved to {step.file}</Text>
            <SelectInput items={[{ key: 'back', label: 'Back to Backups', value: 'back' }]} onSelect={onBack} />
          </Box>
        </Frame>
      );
    case 'failed':
      return (
        <Frame title={title} hints={['esc back']}>
          <ErrorLine message={step.message} />
        </Frame>
      );
  }
}
