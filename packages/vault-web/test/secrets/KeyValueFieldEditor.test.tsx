import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils.js';
import { KeyValueFieldEditor } from '../../src/secrets/ui/components/KeyValueFieldEditor.js';
import type { KeyValueEntry } from '../../src/core/headless/types.js';
import type { KeyValueSuggestion } from '../../src/secrets/headless/keyValue.js';

const CLASS_ENTRY: KeyValueEntry = { key: 'class', label: 'Class', value: 'B', sensitive: false };
const PIN_ENTRY: KeyValueEntry = { key: 'pin', label: 'PIN', value: '0000-placeholder', sensitive: true };

/** A controlled host that records every value the editor emits. */
function Harness({
  initial = [],
  suggestions,
  onValue,
}: {
  initial?: KeyValueEntry[];
  suggestions?: KeyValueSuggestion[];
  onValue?: (value: KeyValueEntry[]) => void;
}) {
  const [value, setValue] = useState<KeyValueEntry[]>(initial);
  return (
    <KeyValueFieldEditor
      label="Details"
      value={value}
      suggestions={suggestions}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

function lastValue(spy: ReturnType<typeof vi.fn>): KeyValueEntry[] {
  return spy.mock.calls[spy.mock.calls.length - 1][0];
}

describe('KeyValueFieldEditor', () => {
  it('renders each entry with labelled inputs, a sensitive switch and a named remove button', () => {
    render(<Harness initial={[CLASS_ENTRY, PIN_ENTRY]} />);
    expect(screen.getByLabelText('Label of Class')).toHaveValue('Class');
    expect(screen.getByLabelText('Value of Class')).toHaveValue('B');
    expect(screen.getByLabelText('Value of PIN')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Value of Class')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('switch', { name: 'PIN is sensitive' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Class is sensitive' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Remove Class' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove PIN' })).toBeInTheDocument();
  });

  it('adds an empty row whose key follows its label', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await user.click(screen.getByRole('button', { name: 'Add detail' }));
    expect(lastValue(onValue)).toEqual([{ key: '', label: '', value: '', sensitive: false }]);

    await user.type(screen.getByLabelText('Label of detail 1'), 'Vehicle class');
    expect(lastValue(onValue)[0]).toMatchObject({ key: 'vehicle_class', label: 'Vehicle class' });

    await user.type(screen.getByLabelText('Value of Vehicle class'), 'B');
    expect(lastValue(onValue)[0]).toEqual({ key: 'vehicle_class', label: 'Vehicle class', value: 'B', sensitive: false });
  });

  it('dedupes a derived key with _2, _3', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={[CLASS_ENTRY]} onValue={onValue} />);

    await user.click(screen.getByRole('button', { name: 'Add detail' }));
    await user.type(screen.getByLabelText('Label of detail 2'), 'Class');
    expect(lastValue(onValue)[1].key).toBe('class_2');

    await user.click(screen.getByRole('button', { name: 'Add detail' }));
    await user.type(screen.getByLabelText('Label of detail 3'), 'Class');
    expect(lastValue(onValue)[2].key).toBe('class_3');
  });

  it('keeps the key of a loaded entry when its label changes', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={[CLASS_ENTRY]} onValue={onValue} />);
    await user.type(screen.getByLabelText('Label of Class'), 'ification');
    expect(lastValue(onValue)[0]).toMatchObject({ key: 'class', label: 'Classification' });
  });

  it('removes an entry', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={[CLASS_ENTRY, PIN_ENTRY]} onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'Remove Class' }));
    expect(lastValue(onValue)).toEqual([PIN_ENTRY]);
    expect(screen.queryByLabelText('Label of Class')).not.toBeInTheDocument();
  });

  it('adds a suggested entry from its chip, and stops offering it', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness
        onValue={onValue}
        suggestions={[
          { key: 'class', label: 'Class', sensitive: false },
          { key: 'restrictions', label: 'Restrictions', sensitive: false },
          { key: 'pin', label: 'PIN', sensitive: true },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add: PIN' }));
    expect(lastValue(onValue)).toEqual([{ key: 'pin', label: 'PIN', value: '', sensitive: true }]);
    expect(screen.queryByRole('button', { name: 'Add: PIN' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add: Class' })).toBeInTheDocument();
    expect(screen.getByLabelText('Value of PIN')).toHaveAttribute('type', 'password');

    // A suggested key is kept when the label is edited.
    await user.type(screen.getByLabelText('Label of PIN'), ' code');
    expect(lastValue(onValue)[0]).toMatchObject({ key: 'pin', label: 'PIN code' });
  });

  it('toggles an entry sensitive, and shows and hides a sensitive value', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={[CLASS_ENTRY]} onValue={onValue} />);

    await user.click(screen.getByRole('switch', { name: 'Class is sensitive' }));
    expect(lastValue(onValue)[0].sensitive).toBe(true);
    const input = screen.getByLabelText('Value of Class');
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show Class' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide Class' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows a field error and disables every control when disabled', () => {
    render(
      <KeyValueFieldEditor
        label="Details"
        value={[CLASS_ENTRY]}
        onChange={vi.fn()}
        error="Every Details entry needs a label"
        disabled
      />,
    );
    expect(screen.getByText('Every Details entry needs a label')).toBeInTheDocument();
    const row = screen.getByTestId('keyvalue-row-0');
    expect(within(row).getByLabelText('Value of Class')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add detail' })).toBeDisabled();
  });
});
