import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';

import { render } from '../../utils/test-utils';
import { CardFieldDiff, formatDiffValue } from '../../../components/cards/CardFieldDiff';
import type { FieldDefinition } from '../../../types';

const PLAIN: FieldDefinition = {
  name: 'cardholder_name',
  label: 'Cardholder Name',
  type: 'string',
  required: true,
  sensitive: false,
};

const SENSITIVE: FieldDefinition = {
  name: 'number',
  label: 'Card Number',
  type: 'string',
  required: true,
  sensitive: true,
};

describe('formatDiffValue', () => {
  it('shows a non-sensitive value in full', () => {
    expect(formatDiffValue('ADA LOVELACE', false)).toBe('ADA LOVELACE');
  });

  it('reduces a sensitive value to its last four characters', () => {
    // The old card only has to be recognisable, not reconstructable.
    expect(formatDiffValue('4242424242424242', true)).toBe('•••• 4242');
  });

  it('never leaks a short sensitive value by showing all of it', () => {
    expect(formatDiffValue('123', true)).toBe('••••');
    expect(formatDiffValue('1234', true)).toBe('••••');
  });

  it('renders an em dash for an absent value', () => {
    expect(formatDiffValue('', false)).toBe('—');
    expect(formatDiffValue('   ', true)).toBe('—');
  });
});

describe('CardFieldDiff', () => {
  it('states the before and after when a field changes', () => {
    render(
      <CardFieldDiff field={PLAIN} current="ADA LOVELACE" proposed="ADA B LOVELACE" changed />,
    );

    const row = screen.getByLabelText(/^Cardholder Name: changes from/i);
    expect(within(row).getByText('Changes')).toBeInTheDocument();
    expect(within(row).getByText('ADA LOVELACE')).toBeInTheDocument();
    expect(within(row).getByText('ADA B LOVELACE')).toBeInTheDocument();
  });

  it('states plainly that an untouched field is unchanged', () => {
    // Silence would read as a field that was forgotten rather than kept.
    render(
      <CardFieldDiff
        field={PLAIN}
        current="ADA LOVELACE"
        proposed="ADA LOVELACE"
        changed={false}
      />,
    );

    const row = screen.getByLabelText(/^Cardholder Name: unchanged$/i);
    expect(within(row).getByText('Unchanged')).toBeInTheDocument();
    expect(within(row).getByText('ADA LOVELACE')).toBeInTheDocument();
  });

  it('masks both sides of a sensitive comparison', () => {
    const { container } = render(
      <CardFieldDiff
        field={SENSITIVE}
        current="4242424242424242"
        proposed="4111111111111111"
        changed
      />,
    );

    expect(screen.getByText('•••• 4242')).toBeInTheDocument();
    expect(screen.getByText('•••• 1111')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{13,}/);
  });

  it('explains the security code rather than comparing it', () => {
    const { container } = render(
      <CardFieldDiff
        field={{ ...SENSITIVE, name: 'cvv', label: 'CVV / CVC' }}
        current="123"
        proposed=""
        changed={false}
        notCarriedForward
      />,
    );

    expect(screen.getByText(/new code needed/i)).toBeInTheDocument();
    expect(screen.getByText(/never reused/i)).toBeInTheDocument();
    // The stored code is not shown at all, masked or otherwise.
    expect(container.textContent).not.toContain('123');
  });
});
