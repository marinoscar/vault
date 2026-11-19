import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils.js';
import { CountryField } from '../../src/secrets/ui/components/CountryField.js';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (code: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CountryField
      label="Issuing country"
      value={value}
      onChange={(code) => {
        setValue(code);
        onValue?.(code);
      }}
    />
  );
}

describe('CountryField', () => {
  it('shows a stored code as "<name> (<alpha3>)"', () => {
    render(<Harness initial="UTO" />);
    expect(screen.getByRole('combobox', { name: 'Issuing country' })).toHaveValue('Utopia (ICAO specimen state) (UTO)');
  });

  it('finds a country by name or code and stores its alpha-3 code', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    const input = screen.getByRole('combobox', { name: 'Issuing country' });
    await user.type(input, 'germ');
    await user.click(await screen.findByRole('option', { name: 'Germany (DEU)' }));
    expect(onValue).toHaveBeenLastCalledWith('DEU');
    expect(input).toHaveValue('Germany (DEU)');

    await user.clear(input);
    await user.type(input, 'NLD');
    expect(await screen.findByRole('option', { name: 'Netherlands (NLD)' })).toBeInTheDocument();
  });

  it('clears to an empty code', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="DEU" onValue={onValue} />);
    await user.clear(screen.getByRole('combobox', { name: 'Issuing country' }));
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('keeps an unknown stored code visible instead of dropping it', () => {
    render(<Harness initial="ZZZ" />);
    expect(screen.getByRole('combobox', { name: 'Issuing country' })).toHaveValue('Unknown code (ZZZ)');
  });
});
