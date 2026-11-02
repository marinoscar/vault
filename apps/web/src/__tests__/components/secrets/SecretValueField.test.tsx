import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { clipboardMock } from '../../setup';
import { MASK, SecretValueField } from '../../../components/secrets/SecretValueField';
import { SECRET_CLIPBOARD_CLEAR_MS, SECRET_REVEAL_TIMEOUT_MS } from '../../../utils/secretFields';
import type { FieldDefinition } from '../../../types';

const PASSWORD: FieldDefinition = { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true };
const USERNAME: FieldDefinition = { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false };
const CARD_NUMBER: FieldDefinition = { name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true };
const VALUE = 'placeholder-pass-123';

/**
 * Copy clicks go through fireEvent, not userEvent: userEvent.setup() swaps in
 * its own clipboard, which would hide the writes asserted on here.
 */
async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe('SecretValueField', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('masks a sensitive value until revealed, and never names the value', () => {
    render(<SecretValueField field={PASSWORD} value={VALUE} />);
    expect(screen.getByText(MASK)).toBeInTheDocument();
    expect(screen.queryByText(VALUE)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label') ?? '').not.toContain(VALUE);
    }
  });

  it('reveals and hides on toggle, announcing each change', async () => {
    render(<SecretValueField field={PASSWORD} value={VALUE} />);
    const reveal = screen.getByRole('button', { name: 'Reveal Password' });
    expect(reveal).toHaveAttribute('aria-pressed', 'false');

    await click(reveal);
    expect(screen.getByText(VALUE)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Password revealed');

    await click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(screen.queryByText(VALUE)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Password hidden');
  });

  it('masks a revealed value again after the timeout', async () => {
    vi.useFakeTimers();
    render(<SecretValueField field={PASSWORD} value={VALUE} />);
    await click(screen.getByRole('button', { name: 'Reveal Password' }));
    expect(screen.getByText(VALUE)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECRET_REVEAL_TIMEOUT_MS - 1);
    });
    expect(screen.getByText(VALUE)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText(VALUE)).not.toBeInTheDocument();
    expect(screen.getByText(MASK)).toBeInTheDocument();
  });

  it('shows a plain value with only a copy button', () => {
    render(<SecretValueField field={USERNAME} value="person.a@example.test" />);
    expect(screen.getByText('person.a@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Username' })).toBeInTheDocument();
  });

  it('renders an empty value as a dash without actions', () => {
    render(<SecretValueField field={PASSWORD} value="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('copies a masked value without revealing it, and clears the clipboard after 30 seconds', async () => {
    vi.useFakeTimers();
    clipboardMock.readText.mockResolvedValue(VALUE);
    render(<SecretValueField field={PASSWORD} value={VALUE} />);

    await click(screen.getByRole('button', { name: 'Copy Password' }));

    expect(clipboardMock.writeText).toHaveBeenCalledWith(VALUE);
    expect(screen.queryByText(VALUE)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Password copied. The clipboard is cleared in 30 seconds.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECRET_CLIPBOARD_CLEAR_MS - 1);
    });
    expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(clipboardMock.writeText).toHaveBeenLastCalledWith('');
  });

  it('leaves the clipboard alone when the user copied something else meanwhile', async () => {
    vi.useFakeTimers();
    clipboardMock.readText.mockResolvedValue('something the user copied later');
    render(<SecretValueField field={PASSWORD} value={VALUE} />);

    await click(screen.getByRole('button', { name: 'Copy Password' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECRET_CLIPBOARD_CLEAR_MS);
    });

    expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
  });

  it('formats a card number for pasting into a checkout form', async () => {
    render(<SecretValueField field={CARD_NUMBER} value="4242 4242 4242 4242" />);
    await click(screen.getByRole('button', { name: 'Copy Card Number' }));
    expect(clipboardMock.writeText).toHaveBeenCalledWith('4242424242424242');
  });

  it('announces a failed copy', async () => {
    clipboardMock.writeText.mockRejectedValue(new Error('denied'));
    render(<SecretValueField field={USERNAME} value="person.a@example.test" />);
    await click(screen.getByRole('button', { name: 'Copy Username' }));
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed');
  });
});
