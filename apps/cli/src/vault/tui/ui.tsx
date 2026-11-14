import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cliDisplayName, cliVersion } from '@marinoscar/platform-cli';

import type { Card, StepState, Tone } from './backups-logic.js';

// =============================================================================
// Small ink building blocks for Vault's TUI screens
// =============================================================================
//
// The platform's Frame is not exported, so this is a look-alike (same border,
// header and hint line) plus a spinner, cards, a checkbox list and a masked
// field. No dependency beyond ink, ink-text-input and React.
// =============================================================================

export function useColumns(): number {
  const { stdout } = useStdout();
  const read = (): number => (stdout?.columns && stdout.columns > 0 ? stdout.columns : 80);
  const [cols, setCols] = useState(read);
  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setCols(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return cols;
}

/** A ref that is false once the component unmounted (guards async setState). */
export function useMounted(): { current: boolean } {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return mounted;
}

export function Frame({ title, hints, children }: { title: string; hints: string[]; children: ReactNode }): ReactNode {
  const cols = useColumns();
  const narrow = cols < 56;
  return (
    <Box
      borderStyle={narrow ? undefined : 'round'}
      borderColor="gray"
      paddingX={narrow ? 0 : 2}
      paddingY={narrow ? 0 : 1}
      flexDirection="column"
    >
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text bold color="cyan">{cliDisplayName()}</Text>
          <Text dimColor> v{cliVersion()}</Text>
          <Text dimColor> · </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box flexDirection="column">{children}</Box>
        <Text dimColor wrap="wrap">{[...hints, 'ctrl-c exit'].join('  ·  ')}</Text>
      </Box>
    </Box>
  );
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A ticking counter for spinners and indeterminate bars. */
export function useTick(intervalMs = 80, active = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return tick;
}

export function Spinner({ color = 'cyan' }: { color?: string }): ReactNode {
  const tick = useTick();
  return <Text color={color}>{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>;
}

export function Loading({ label }: { label: string }): ReactNode {
  return (
    <Box gap={1}>
      <Spinner />
      <Text dimColor>{label}</Text>
    </Box>
  );
}

export function StepLine({ state, label, detail }: { state: StepState; label: string; detail?: string }): ReactNode {
  const icon =
    state === 'active' ? <Spinner /> : state === 'done' ? <Text color="green">✔</Text> : state === 'failed' ? <Text color="red">✖</Text> : <Text dimColor>·</Text>;
  return (
    <Box gap={1}>
      {icon}
      <Text {...(state === 'pending' || state === 'skipped' ? { dimColor: true } : {})}>{label}</Text>
      {detail ? <Text dimColor>{detail}</Text> : null}
    </Box>
  );
}

export function toneColor(t: Tone): string {
  return t;
}

export function CardBox({ card, width }: { card: Card; width: number | string }): ReactNode {
  return (
    <Box borderStyle="round" borderColor={toneColor(card.tone)} paddingX={1} flexDirection="column" width={width}>
      <Text dimColor>{card.title}</Text>
      <Text bold color={toneColor(card.tone)} wrap="truncate-end">
        {card.value}
      </Text>
      <Text dimColor wrap="truncate-end">
        {card.detail}
      </Text>
    </Box>
  );
}

/** Four cards: one row on a wide terminal, two by two otherwise. */
export function CardGrid({ cards }: { cards: Card[] }): ReactNode {
  const cols = useColumns();
  const perRow = cols >= 110 ? 4 : cols >= 56 ? 2 : 1;
  const rows: Card[][] = [];
  for (let i = 0; i < cards.length; i += perRow) rows.push(cards.slice(i, i + perRow));
  const width = `${Math.floor(100 / perRow)}%`;
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={i}>
          {row.map((c) => (
            <CardBox key={c.title} card={c} width={width} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <Text bold color="cyan">
      {children}
    </Text>
  );
}

export function Field({ label, value, color, dim, width = 12 }: { label: string; value: string; color?: string; dim?: boolean; width?: number }): ReactNode {
  return (
    <Box>
      <Text dimColor>{label.padEnd(width)}</Text>
      <Text {...(color ? { color } : {})} {...(dim ? { dimColor: true } : {})} wrap="wrap">
        {value}
      </Text>
    </Box>
  );
}

export function Issues({ issues }: { issues: { level: 'error' | 'warning'; message: string }[] }): ReactNode {
  if (issues.length === 0) return null;
  return (
    <Box flexDirection="column">
      {issues.map((i, n) => (
        <Box key={n}>
          <Text color={i.level === 'error' ? 'red' : 'yellow'}>{i.level === 'error' ? '✖ ' : '! '}</Text>
          <Text color={i.level === 'error' ? 'red' : 'yellow'} wrap="wrap">
            {i.message}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function ErrorLine({ message }: { message: string }): ReactNode {
  return (
    <Text color="red" wrap="wrap">
      ✖ {message}
    </Text>
  );
}

/** A labelled text field. `mask` hides what is typed (passwords). */
export function InputField({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  mask,
  error,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  mask?: string;
  error?: string | undefined;
  help?: ReactNode;
}): ReactNode {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{'› '}</Text>
        <Text>{label} </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          {...(placeholder ? { placeholder } : {})}
          {...(mask ? { mask } : {})}
        />
      </Box>
      {help ? <Box marginLeft={2}>{help}</Box> : null}
      {error ? (
        <Box marginLeft={2}>
          <Text color="red" wrap="wrap">
            {error}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export interface CheckItem {
  key: string;
  label: string;
  description?: string;
  checked: boolean;
}

/** ↑↓ move, space toggles, enter confirms. */
export function CheckboxList({
  items,
  onSubmit,
  validate,
}: {
  items: CheckItem[];
  onSubmit: (keys: string[]) => void;
  validate?: (keys: string[]) => true | string;
}): ReactNode {
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.filter((i) => i.checked).map((i) => i.key)));
  const [error, setError] = useState<string | undefined>(undefined);
  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => (c + items.length - 1) % items.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % items.length);
    else if (input === ' ') {
      const k = items[cursor]!.key;
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
      setError(undefined);
    } else if (key.return) {
      const keys = items.filter((i) => checked.has(i.key)).map((i) => i.key);
      const v = validate ? validate(keys) : true;
      if (v === true) onSubmit(keys);
      else setError(v);
    }
  });
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={item.key}>
          <Text color={i === cursor ? 'cyan' : undefined}>{i === cursor ? '❯ ' : '  '}</Text>
          <Text color={checked.has(item.key) ? 'green' : 'gray'}>{checked.has(item.key) ? '◉ ' : '◯ '}</Text>
          <Text {...(i === cursor ? { color: 'cyan' } : {})}>{item.label}</Text>
          {item.description && i === cursor ? <Text dimColor>  {item.description}</Text> : null}
        </Box>
      ))}
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}
