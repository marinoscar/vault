import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils.js';
import { SecretVersionDrawer } from '../../src/secrets/ui/components/SecretVersionDrawer.js';
import { MASK } from '../../src/secrets/ui/components/SecretValueField.js';
import type { SecretDetail, SecretType, SecretVersion } from '../../src/core/headless/types.js';

const LOGIN: SecretType = {
  id: 'type-login',
  name: 'Login',
  description: null,
  icon: 'Key',
  isSystem: true,
  allowAttachments: false,
  createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
    { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
    { name: 'url', label: 'URL', type: 'string', required: false, sensitive: false },
    { name: 'notes', label: 'Notes', type: 'string', required: false, sensitive: false },
  ],
};

const SECRET: SecretDetail = {
  id: 'secret-1',
  name: 'Product X admin',
  description: null,
  type: LOGIN,
  currentVersion: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  values: { username: 'admin@example.test', password: 'current-pass', url: 'https://x.example.test', notes: 'new note' },
  createdBy: null,
  attachments: [],
};

const VERSIONS: SecretVersion[] = [
  { id: 'v3', version: 3, isCurrent: true, createdAt: '2026-03-01T00:00:00Z', createdBy: null },
  { id: 'v2', version: 2, isCurrent: false, createdAt: '2026-02-01T00:00:00Z', createdBy: { id: 'u1', email: 'person.a@example.test' } },
  { id: 'v1', version: 1, isCurrent: false, createdAt: '2026-01-01T00:00:00Z', createdBy: null },
];

const V2_DETAIL = {
  ...VERSIONS[1],
  values: { username: 'root@example.test', password: 'old-pass', url: 'https://x.example.test' },
  attachments: [],
};

function setup(overrides: Partial<React.ComponentProps<typeof SecretVersionDrawer>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    secret: SECRET,
    versions: VERSIONS,
    loadVersion: vi.fn().mockResolvedValue(V2_DETAIL),
    onRollback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<SecretVersionDrawer {...props} />);
  return props;
}

describe('SecretVersionDrawer', () => {
  it('lists every version, the current one marked and not comparable', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Version history' });
    expect(within(dialog).getByText('Current')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Compare version 2 with current' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Compare version 1 with current' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Compare version 3 with current' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/person\.a@example\.test/)).toBeInTheDocument();
  });

  it('compares a version with the current values field by field', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));

    expect(props.loadVersion).toHaveBeenCalledWith('v2');
    expect(await screen.findByRole('dialog', { name: 'Version 2' })).toBeInTheDocument();
    expect(screen.getByText('3 fields differ from the current version (v3)')).toBeInTheDocument();

    expect(screen.getByTestId('diff-username')).toHaveAttribute('data-change', 'changed');
    expect(screen.getByTestId('diff-password')).toHaveAttribute('data-change', 'changed');
    expect(screen.getByTestId('diff-url')).toHaveAttribute('data-change', 'unchanged');
    expect(screen.getByTestId('diff-notes')).toHaveAttribute('data-change', 'added');

    const username = within(screen.getByTestId('diff-username'));
    expect(username.getByText('root@example.test')).toBeInTheDocument();
    expect(username.getByText('admin@example.test')).toBeInTheDocument();
    expect(username.getByText('Changed')).toBeInTheDocument();
  });

  it('keeps sensitive values masked until "Show values" is switched on', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    const password = within(await screen.findByTestId('diff-password'));

    expect(password.getAllByText(MASK)).toHaveLength(2);
    expect(password.queryByText('old-pass')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Show values' }));
    expect(password.getByText('old-pass')).toBeInTheDocument();
    expect(password.getByText('current-pass')).toBeInTheDocument();
  });

  it('restores a version only after confirmation, then returns to the list', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    await user.click(await screen.findByRole('button', { name: 'Restore version 2' }));

    const confirm = await screen.findByRole('dialog', { name: 'Restore version 2?' });
    expect(within(confirm).getByText(/creates version 4/)).toBeInTheDocument();
    expect(props.onRollback).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(props.onRollback).toHaveBeenCalledWith('v2'));
    expect(await screen.findByRole('dialog', { name: 'Version history' })).toBeInTheDocument();
  });

  it('does not restore when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    await user.click(await screen.findByRole('button', { name: 'Restore version 2' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Restore version 2?' })).getByRole('button', { name: 'Cancel' }));
    expect(props.onRollback).not.toHaveBeenCalled();
  });

  it('shows the error when a restore fails', async () => {
    const user = userEvent.setup();
    setup({ onRollback: vi.fn().mockRejectedValue(new Error('Rollback refused')) });
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    await user.click(await screen.findByRole('button', { name: 'Restore version 2' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Restore version 2?' })).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Rollback refused')).toBeInTheDocument();
  });

  it('offers no restore without write permission', async () => {
    const user = userEvent.setup();
    setup({ onRollback: undefined });
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    await screen.findByTestId('diff-username');
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
  });

  it('goes back to the list and closes', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Compare version 2 with current' }));
    await user.click(await screen.findByRole('button', { name: 'Back to all versions' }));
    expect(screen.getByRole('dialog', { name: 'Version history' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close version history' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows an empty history', () => {
    setup({ versions: [] });
    expect(screen.getByText('No version history available.')).toBeInTheDocument();
  });
});
