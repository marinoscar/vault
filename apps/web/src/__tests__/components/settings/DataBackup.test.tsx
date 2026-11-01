import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import {
  DataBackup,
  BACKUP_SUCCESS_MESSAGE,
} from '../../../components/settings/DataBackup';
import { BACKUP_PASSWORD_WARNING } from '../../../utils/backupPassword';

vi.mock('../../../services/api', () => ({
  downloadSecretsBackup: vi.fn(),
}));
vi.mock('../../../utils/saveBlob', () => ({
  saveBlobAsFile: vi.fn(),
}));

import { downloadSecretsBackup } from '../../../services/api';
import { saveBlobAsFile } from '../../../utils/saveBlob';

const mockDownload = vi.mocked(downloadSecretsBackup);
const mockSave = vi.mocked(saveBlobAsFile);

const getPassword = () => screen.getByLabelText('Password', { selector: 'input' });
const getConfirm = () => screen.getByLabelText('Confirm password');
const getDownloadButton = () => screen.getByRole('button', { name: /download backup|preparing/i });

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
  await user.type(getPassword(), password);
  await user.type(getConfirm(), confirm);
}

describe('DataBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownload.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'vault-backup-2026-05-06.zip',
      secretCount: 2,
      attachmentCount: 1,
    });
  });

  it('renders the title, info text and default options', () => {
    render(<DataBackup />);

    expect(screen.getByText('Back up my data')).toBeInTheDocument();
    expect(
      screen.getByText(/To open it, use 7-Zip on Windows or Keka on Mac/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Include attachments')).toBeChecked();
    expect(screen.getByLabelText('Include old versions')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /suggest one for me/i })).toBeInTheDocument();
  });

  it('shows no warning for an empty password', () => {
    render(<DataBackup />);
    expect(screen.queryByText(BACKUP_PASSWORD_WARNING)).not.toBeInTheDocument();
  });

  it('shows the soft warning for a single word like "sunshine"', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await user.type(getPassword(), 'sunshine');

    expect(screen.getByText(BACKUP_PASSWORD_WARNING)).toBeInTheDocument();
    // Soft: the button stays enabled.
    expect(getDownloadButton()).toBeEnabled();
  });

  it('shows no warning for "blue tiger river"', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await user.type(getPassword(), 'blue tiger river');

    expect(screen.queryByText(BACKUP_PASSWORD_WARNING)).not.toBeInTheDocument();
  });

  it('blocks a password shorter than 6 characters with a validation message', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await fill(user, '12345');
    await user.click(getDownloadButton());

    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('blocks mismatched passwords', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await fill(user, 'blue tiger river', 'blue tiger rivet');
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    await user.click(getDownloadButton());

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('"Suggest one for me" fills both fields with a three-word phrase and reveals them', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await user.click(screen.getByRole('button', { name: /suggest one for me/i }));

    const password = getPassword() as HTMLInputElement;
    const confirm = getConfirm() as HTMLInputElement;
    expect(password.value.split(' ')).toHaveLength(3);
    expect(confirm.value).toBe(password.value);
    expect(password.type).toBe('text');
    expect(screen.queryByText(BACKUP_PASSWORD_WARNING)).not.toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    expect((getPassword() as HTMLInputElement).type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect((getPassword() as HTMLInputElement).type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect((getPassword() as HTMLInputElement).type).toBe('password');
  });

  it('downloads with the checkbox values, saves the file, shows the notice and clears the fields', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await fill(user, 'blue tiger river');
    await user.click(screen.getByLabelText('Include attachments'));
    await user.click(screen.getByLabelText('Include old versions'));
    await user.click(getDownloadButton());

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockDownload).toHaveBeenCalledWith({
      password: 'blue tiger river',
      includeAttachments: false,
      includeVersions: true,
    });
    expect(mockSave).toHaveBeenCalledWith(expect.any(Blob), 'vault-backup-2026-05-06.zip');
    expect(await screen.findByText(BACKUP_SUCCESS_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/Write your password down/)).toBeInTheDocument();
    expect((getPassword() as HTMLInputElement).value).toBe('');
    expect((getConfirm() as HTMLInputElement).value).toBe('');
  });

  it('uses the defaults (attachments on, versions off) when untouched', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await fill(user, 'blue tiger river');
    await user.click(getDownloadButton());

    await waitFor(() => expect(mockDownload).toHaveBeenCalled());
    expect(mockDownload).toHaveBeenCalledWith({
      password: 'blue tiger river',
      includeAttachments: true,
      includeVersions: false,
    });
  });

  it('disables the button and shows a loading label while downloading', async () => {
    const user = userEvent.setup();
    let resolve!: (v: Awaited<ReturnType<typeof downloadSecretsBackup>>) => void;
    mockDownload.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DataBackup />);

    await fill(user, 'blue tiger river');
    await user.click(getDownloadButton());

    expect(await screen.findByRole('button', { name: /preparing backup/i })).toBeDisabled();

    resolve({ blob: new Blob(['x']), filename: 'f.zip', secretCount: 0, attachmentCount: 0 });
    expect(await screen.findByRole('button', { name: /download backup/i })).toBeEnabled();
  });

  it('shows the API error and keeps the password so the user can retry', async () => {
    const user = userEvent.setup();
    mockDownload.mockRejectedValue(new Error('Storage is unavailable'));
    render(<DataBackup />);

    await fill(user, 'blue tiger river');
    await user.click(getDownloadButton());

    expect(await screen.findByText('Storage is unavailable')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.queryByText(BACKUP_SUCCESS_MESSAGE)).not.toBeInTheDocument();
    expect((getPassword() as HTMLInputElement).value).toBe('blue tiger river');
  });
});
