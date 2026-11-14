import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cliDisplayName, cliVersion } from '@marinoscar/platform-cli';
import type { TuiScreenProps } from '@marinoscar/platform-cli/tui';

import {
  envOverrideWarning,
  fetchCurrentToken,
  localTokenState,
  replaceStoredToken,
  resolveTokenName,
  revokePat,
  type LocalTokenState,
  type PatListItem,
  type ReplaceTokenResult,
  type TokenDuration,
} from '../lib/tokens.js';
import {
  BACK_CHOICE,
  CUSTOM_CHOICE,
  canOfferRevoke,
  currentTokenRows,
  describeChoice,
  durationChoices,
  expiryAdvice,
  parseCustomInput,
  presetFromValue,
  type FieldRow,
} from './token-logic.js';

// =============================================================================
// TUI: "Access token" (route `token`)
// =============================================================================
//
// Shows the stored token's expiry and replaces it with a longer-lived one. The
// logic is in token-logic.ts and lib/tokens.ts; this file only renders. The raw
// token never enters React state: `replaceStoredToken` stores it and returns the
// row without it.
// =============================================================================

type Step =
  | { kind: 'loading' }
  | { kind: 'overview' }
  | { kind: 'choose' }
  | { kind: 'custom'; text: string; error?: string }
  | { kind: 'working'; choice: TokenDuration }
  | { kind: 'created'; result: ReplaceTokenResult }
  | { kind: 'revoking'; result: ReplaceTokenResult }
  | { kind: 'finished'; result: ReplaceTokenResult; revoked: boolean; error?: string }
  | { kind: 'failed'; message: string };

function Frame({ title, hints, children }: { title: string; hints: string[]; children: ReactNode }): ReactNode {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} flexDirection="column">
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text bold color="cyan">{cliDisplayName()}</Text>
          <Text dimColor> v{cliVersion()}</Text>
          <Text dimColor> · </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box flexDirection="column">{children}</Box>
        <Text dimColor>{[...hints, 'ctrl-c exit'].join('  ·  ')}</Text>
      </Box>
    </Box>
  );
}

function Rows({ rows }: { rows: FieldRow[] }): ReactNode {
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Box key={r.label}>
          <Text dimColor>{r.label.padEnd(10)}</Text>
          <Text {...(r.color ? { color: r.color } : {})} {...(r.dim ? { dimColor: true } : {})}>
            {r.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function TokenScreen({ onDone }: TuiScreenProps): ReactNode {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [local, setLocal] = useState<LocalTokenState | undefined>(undefined);
  const [current, setCurrent] = useState<PatListItem | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refresh = (): void => {
    let state: LocalTokenState;
    try {
      state = localTokenState();
    } catch (err) {
      setStep({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    setLocal(state);
    if (state.source === undefined) {
      setStep({ kind: 'overview' });
      return;
    }
    void fetchCurrentToken()
      .then(({ current: c }) => {
        if (!mounted.current) return;
        setCurrent(c);
        setLoadError(undefined);
        setStep({ kind: 'overview' });
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setStep({ kind: 'overview' });
      });
  };

  useEffect(refresh, []);

  const create = (choice: TokenDuration): void => {
    setStep({ kind: 'working', choice });
    void replaceStoredToken({ ...choice, name: resolveTokenName(undefined), revokePrevious: false })
      .then((result) => {
        if (!mounted.current) return;
        setLocal(localTokenState());
        setStep({ kind: 'created', result });
      })
      .catch((err: unknown) => {
        if (mounted.current) setStep({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
      });
  };

  const revokeOld = (result: ReplaceTokenResult): void => {
    if (!result.previous) return;
    setStep({ kind: 'revoking', result });
    // The stored token is now the new one, so it makes this call.
    void revokePat(result.previous.id)
      .then(() => {
        if (mounted.current) setStep({ kind: 'finished', result, revoked: true });
      })
      .catch((err: unknown) => {
        if (mounted.current)
          setStep({ kind: 'finished', result, revoked: false, error: err instanceof Error ? err.message : String(err) });
      });
  };

  useInput((_input, key) => {
    if (!key.escape) return;
    if (step.kind === 'choose') setStep({ kind: 'overview' });
    else if (step.kind === 'custom') setStep({ kind: 'choose' });
    else if (step.kind === 'overview' || step.kind === 'failed' || step.kind === 'finished' || step.kind === 'created') {
      onDone();
    }
  });

  const title = 'Access token';

  if (step.kind === 'loading' || local === undefined) {
    return (
      <Frame title={title} hints={['esc back']}>
        <Text dimColor>Checking the token with the server…</Text>
      </Frame>
    );
  }

  if (step.kind === 'failed') {
    return (
      <Frame title={title} hints={['esc back']}>
        <Text color="red">✖ {step.message}</Text>
      </Frame>
    );
  }

  if (step.kind === 'overview') {
    const advice = expiryAdvice(local, current);
    const signedIn = local.source !== undefined;
    const items = [
      ...(signedIn ? [{ key: 'create', label: 'Create a longer-lived token and store it', value: 'create' }] : []),
      { key: 'back', label: 'Back', value: 'back' },
    ];
    return (
      <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Rows rows={currentTokenRows(local, current)} />
          {loadError ? <Text color="red">Could not read your tokens from the server: {loadError}</Text> : null}
          {advice ? <Text color="yellow">{advice}</Text> : null}
          {local.source === 'environment' ? <Text color="yellow">{envOverrideWarning()}</Text> : null}
          <SelectInput
            items={items}
            onSelect={(item) => (item.value === 'create' ? setStep({ kind: 'choose' }) : onDone())}
          />
        </Box>
      </Frame>
    );
  }

  if (step.kind === 'choose') {
    return (
      <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text>How long should the new token last?</Text>
          <SelectInput
            items={durationChoices()}
            onSelect={(item) => {
              if (item.value === BACK_CHOICE) setStep({ kind: 'overview' });
              else if (item.value === CUSTOM_CHOICE) setStep({ kind: 'custom', text: '' });
              else {
                const preset = presetFromValue(item.value);
                if (preset) create(preset);
              }
            }}
          />
        </Box>
      </Frame>
    );
  }

  if (step.kind === 'custom') {
    return (
      <Frame title={title} hints={['enter create', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text>Lifetime (1 to 999 minutes, days or months; years become months):</Text>
          <Box>
            <Text dimColor>{'Lifetime  '}</Text>
            <TextInput
              value={step.text}
              placeholder="18 months"
              onChange={(text) => setStep({ kind: 'custom', text })}
              onSubmit={(text) => {
                const parsed = parseCustomInput(text);
                if (parsed.ok) create(parsed.value);
                else setStep({ kind: 'custom', text, error: parsed.error });
              }}
            />
          </Box>
          {step.error ? <Text color="red">{step.error}</Text> : null}
        </Box>
      </Frame>
    );
  }

  if (step.kind === 'working') {
    return (
      <Frame title={title} hints={[]}>
        <Text dimColor>Creating a {describeChoice(step.choice)} token, storing and verifying it…</Text>
      </Frame>
    );
  }

  const result = step.result;
  const createdRows = currentTokenRows(local, {
    id: result.created.id,
    name: result.created.name,
    tokenPrefix: result.created.tokenPrefix,
    expiresAt: result.created.expiresAt,
    createdAt: result.created.createdAt,
    lastUsedAt: null,
  });

  if (step.kind === 'revoking') {
    return (
      <Frame title={title} hints={[]}>
        <Text dimColor>Revoking the previous token…</Text>
      </Frame>
    );
  }

  if (step.kind === 'created') {
    const offer = canOfferRevoke(local, result.previous, result.created.id);
    return (
      <Frame title={title} hints={['↑↓ move', 'enter select', 'esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text color="green">✔ New token stored in {result.file} and verified.</Text>
          <Rows rows={createdRows} />
          {local.source === 'environment' ? <Text color="yellow">{envOverrideWarning()}</Text> : null}
          {offer && result.previous ? (
            <SelectInput
              items={[
                { key: 'revoke', label: `Revoke the previous token "${result.previous.name}"`, value: 'revoke' },
                { key: 'keep', label: 'Keep it (revoke later in the web app or with vault auth token revoke)', value: 'keep' },
              ]}
              onSelect={(item) => (item.value === 'revoke' ? revokeOld(result) : onDone())}
            />
          ) : (
            <SelectInput items={[{ key: 'done', label: 'Done', value: 'done' }]} onSelect={() => onDone()} />
          )}
        </Box>
      </Frame>
    );
  }

  // finished
  return (
    <Frame title={title} hints={['enter back', 'esc back']}>
      <Box flexDirection="column" gap={1}>
        <Text color="green">✔ New token stored in {result.file}.</Text>
        <Rows rows={createdRows} />
        {step.revoked ? <Text>Revoked the previous token.</Text> : null}
        {step.error ? <Text color="red">Could not revoke the previous token: {step.error}</Text> : null}
        <SelectInput items={[{ key: 'done', label: 'Done', value: 'done' }]} onSelect={() => onDone()} />
      </Box>
    </Frame>
  );
}
