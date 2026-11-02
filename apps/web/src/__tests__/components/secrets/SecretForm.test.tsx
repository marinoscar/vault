import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { SecretForm } from '../../../components/secrets/SecretForm';
import type { SecretType } from '../../../types';

const LOGIN: SecretType = {
  id: 'type-login', name: 'Login', description: 'Website credentials', icon: 'Key',
  isSystem: true, allowAttachments: false, createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
    { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
    { name: 'url', label: 'URL', type: 'string', required: false, sensitive: false },
  ],
};
const SERVER: SecretType = {
  id: 'type-server', name: 'Server', description: null, icon: null,
  isSystem: false, allowAttachments: false, createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'port', label: 'Port', type: 'number', required: true, sensitive: false },
    { name: 'tier', label: 'Tier', type: 'select', required: false, sensitive: false, options: ['gold', 'silver'] },
    { name: 'renewal', label: 'Renewal', type: 'date', required: false, sensitive: false },
  ],
};
const CARD: SecretType = {
  id: 'type-card', name: 'Card', description: null, icon: 'CreditCard',
  isSystem: true, allowAttachments: true, createdAt: '2026-01-01T00:00:00Z',
  fields: [{ name: 'number', label: 'Card Number', type: 'string', required: true, sensitive: true }],
};

function renderForm(overrides: Partial<React.ComponentProps<typeof SecretForm>> = {}) {
  const props = {
    mode: 'create' as const,
    types: [LOGIN, SERVER, CARD],
    submitLabel: 'Create secret',
    submittingLabel: 'Creating…',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<SecretForm {...props} />);
  return props;
}

async function pickType(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: /Type/ }));
  await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name }));
}

describe('SecretForm', () => {
  it('requires a type and a name before anything is sent', async () => {
    const user = userEvent.setup();
    const props = renderForm();
    await user.click(screen.getByRole('button', { name: 'Create secret' }));
    expect(await screen.findByText('Type is required')).toBeInTheDocument();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Fix the highlighted fields and try again.')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('renders the type\'s own fields and validates the required ones', async () => {
    const user = userEvent.setup();
    const props = renderForm();
    await pickType(user, 'Login');
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');

    await user.type(screen.getByLabelText(/^Name/), 'Product X admin');
    await user.click(screen.getByRole('button', { name: 'Create secret' }));
    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('clears a field error as soon as the field is edited', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickType(user, 'Login');
    await user.click(screen.getByRole('button', { name: 'Create secret' }));
    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Username/), 'a');
    expect(screen.queryByText('Username is required')).not.toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('checks numbers, dates and select options the way the API does', async () => {
    const user = userEvent.setup();
    const props = renderForm({
      mode: 'edit',
      types: [SERVER],
      initial: { name: 'Org Alpha box', description: '', typeId: SERVER.id, data: { port: 'abc', tier: 'bronze', renewal: 'not-a-date' } },
      submitLabel: 'Save changes',
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Port must be a number')).toBeInTheDocument();
    expect(screen.getByText('Tier must be one of: gold, silver')).toBeInTheDocument();
    expect(screen.getByText('Renewal must be a valid date')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed values with only the type\'s fields, empty optional ones dropped', async () => {
    const user = userEvent.setup();
    const props = renderForm();
    await pickType(user, 'Login');
    await user.type(screen.getByLabelText(/^Name/), '  Product X admin  ');
    await user.type(screen.getByLabelText(/Username/), 'person.a@example.test');
    await user.type(screen.getByLabelText(/^Password/), 'placeholder-pass');
    await user.click(screen.getByRole('button', { name: 'Create secret' }));
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith({
        name: 'Product X admin',
        description: '',
        typeId: LOGIN.id,
        data: { username: 'person.a@example.test', password: 'placeholder-pass' },
      }),
    );
  });

  it('shows the API error and keeps the form', async () => {
    const user = userEvent.setup();
    renderForm({
      mode: 'edit',
      types: [LOGIN],
      initial: { name: 'X', description: '', typeId: LOGIN.id, data: { username: 'u', password: 'p' } },
      submitLabel: 'Save changes',
      onSubmit: vi.fn().mockRejectedValue(new Error('Secret data validation failed')),
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Secret data validation failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('never offers a type change when editing', () => {
    renderForm({
      mode: 'edit',
      types: [LOGIN],
      initial: { name: 'X', description: '', typeId: LOGIN.id, data: {} },
      submitLabel: 'Save changes',
    });
    expect(screen.queryByRole('combobox', { name: /Type/ })).not.toBeInTheDocument();
  });

  it('points the Card type to the Cards scan flow', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickType(user, 'Card');
    expect(screen.getByRole('link', { name: 'Scan it in Cards' })).toHaveAttribute('href', '/cards/import');
  });

  it('cancels without submitting', async () => {
    const user = userEvent.setup();
    const props = renderForm();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
