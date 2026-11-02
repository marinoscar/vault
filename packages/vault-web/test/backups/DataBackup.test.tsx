import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockUser, render } from '../utils/test-utils.js';
import {
  DataBackup,
  BACKUP_SAVE_STARTED_MESSAGE,
  BACKUP_STORAGE_NOT_CONFIGURED_HELPER,
  BACKUP_SUCCESS_MESSAGE,
} from '../../src/backups/ui/components/DataBackup.js';
import { BACKUP_POLL_INTERVAL_MS } from '../../src/backups/headless/useBackupRunHistory.js';
import type { BackupRun, BackupRunsResponse } from '../../src/core/headless/types.js';
import { BACKUP_PASSWORD_WARNING } from '../../src/backups/headless/backupPassword.js';
import { BACKUP_NOTHING_SELECTED_MESSAGE } from '../../src/backups/headless/backupContents.js';

vi.mock('../../src/core/headless/api.js', async (importOriginal) => ({
  // The real client (`api`), which the platform host wraps; the calls under test are mocked.
  api: (await importOriginal<typeof import('../../src/core/headless/api.js')>()).api,
  downloadSecretsBackup: vi.fn(),
  getMyBackupsConfig: vi.fn(),
  saveMyBackupToStorage: vi.fn(),
  getMyBackups: vi.fn(),
  getMyBackupDownloadUrl: vi.fn(),
  deleteMyBackup: vi.fn(),
}));
vi.mock('../../src/core/headless/saveBlob.js', () => ({
  saveBlobAsFile: vi.fn(),
}));
vi.mock('../../src/backups/headless/backupSchedule.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/backups/headless/backupSchedule.js')>()),
  startUrlDownload: vi.fn(),
}));

import {
  deleteMyBackup,
  downloadSecretsBackup,
  getMyBackupDownloadUrl,
  getMyBackups,
  getMyBackupsConfig,
  saveMyBackupToStorage,
} from '../../src/core/headless/api.js';
import { saveBlobAsFile } from '../../src/core/headless/saveBlob.js';
import { startUrlDownload } from '../../src/backups/headless/backupSchedule.js';

const mockDownload = vi.mocked(downloadSecretsBackup);
const mockSave = vi.mocked(saveBlobAsFile);
const mockConfig = vi.mocked(getMyBackupsConfig);
const mockSaveToStorage = vi.mocked(saveMyBackupToStorage);
const mockGetMyBackups = vi.mocked(getMyBackups);
const mockMyDownloadUrl = vi.mocked(getMyBackupDownloadUrl);
const mockDeleteMine = vi.mocked(deleteMyBackup);
const mockStartDownload = vi.mocked(startUrlDownload);

const savedRun: BackupRun = {
  id: 'mine-1',
  status: 'succeeded',
  trigger: 'manual',
  triggeredBy: { id: 'u1', email: 'person-a@example.test', displayName: 'Person A' },
  sizeBytes: 4096,
  userCount: 1,
  secretCount: 3,
  attachmentCount: 1,
  mediaFileCount: 2,
  contents: ['secrets', 'attachments', 'media'],
  warningCount: 0,
  error: null,
  startedAt: '2026-11-01T09:00:00.000Z',
  finishedAt: '2026-11-01T09:00:04.000Z',
  deletedAt: null,
  downloadable: true,
};

const runsPage = (items: BackupRun[]): BackupRunsResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalPages: items.length ? 1 : 0,
});

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
    mockConfig.mockResolvedValue({ storageConfigured: true, keepCount: 10 });
    mockGetMyBackups.mockResolvedValue(runsPage([]));
    mockSaveToStorage.mockResolvedValue({ ...savedRun, id: 'mine-new', status: 'running' });
    mockDownload.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'vault-backup-2026-05-06.zip',
      secretCount: 2,
      attachmentCount: 1,
      mediaFileCount: 0,
    });
  });

  it('renders the title, info text and default options', () => {
    render(<DataBackup />);

    expect(screen.getByText('Back up my data')).toBeInTheDocument();
    expect(
      screen.getByText(/To open it, use 7-Zip on Windows or Keka on Mac/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Secrets')).toBeChecked();
    expect(screen.getByLabelText('Include attachments')).toBeChecked();
    expect(screen.getByLabelText('Include old versions')).not.toBeChecked();
    expect(screen.getByLabelText('Media library')).not.toBeChecked();
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
      includeSecrets: true,
      includeAttachments: false,
      includeVersions: true,
      includeMedia: false,
    });
    expect(mockSave).toHaveBeenCalledWith(expect.any(Blob), 'vault-backup-2026-05-06.zip');
    expect(await screen.findByText(BACKUP_SUCCESS_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/Write your password down/)).toBeInTheDocument();
    expect((getPassword() as HTMLInputElement).value).toBe('');
    expect((getConfirm() as HTMLInputElement).value).toBe('');
  });

  it('uses the defaults (secrets with attachments, nothing else) when untouched', async () => {
    const user = userEvent.setup();
    render(<DataBackup />);

    await fill(user, 'blue tiger river');
    await user.click(getDownloadButton());

    await waitFor(() => expect(mockDownload).toHaveBeenCalled());
    expect(mockDownload).toHaveBeenCalledWith({
      password: 'blue tiger river',
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: false,
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

    resolve({ blob: new Blob(['x']), filename: 'f.zip', secretCount: 0, attachmentCount: 0, mediaFileCount: 0 });
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

  describe('What to back up', () => {
    const summary = () => screen.getByTestId('backup-contents-summary');

    it('shows the group with a summary of the defaults and no system option', () => {
      render(<DataBackup />);

      expect(screen.getByRole('group', { name: 'What to back up' })).toBeInTheDocument();
      expect(summary()).toHaveTextContent('Secrets with attachments');
      expect(screen.queryByLabelText(/System configuration/)).not.toBeInTheDocument();
    });

    it('updates the summary as options change', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(screen.getByLabelText('Include old versions'));
      expect(summary()).toHaveTextContent('Secrets with attachments and old versions');
      await user.click(screen.getByLabelText('Media library'));
      expect(summary()).toHaveTextContent(
        'Secrets with attachments and old versions, media library',
      );
    });

    it('disables and unchecks the nested options when Secrets is off, and restores them', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(screen.getByLabelText('Secrets'));

      expect(screen.getByLabelText('Include attachments')).toBeDisabled();
      expect(screen.getByLabelText('Include attachments')).not.toBeChecked();
      expect(screen.getByLabelText('Include old versions')).toBeDisabled();

      await user.click(screen.getByLabelText('Secrets'));

      expect(screen.getByLabelText('Include attachments')).toBeEnabled();
      expect(screen.getByLabelText('Include attachments')).toBeChecked();
      expect(screen.getByLabelText('Include old versions')).toBeEnabled();
    });

    it('blocks the download and explains when nothing is selected', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await fill(user, 'blue tiger river');
      await user.click(screen.getByLabelText('Secrets'));

      expect(screen.getByText(BACKUP_NOTHING_SELECTED_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByTestId('backup-contents-summary')).not.toBeInTheDocument();
      expect(getDownloadButton()).toBeDisabled();
      expect(mockDownload).not.toHaveBeenCalled();

      await user.click(screen.getByLabelText('Media library'));
      expect(screen.queryByText(BACKUP_NOTHING_SELECTED_MESSAGE)).not.toBeInTheDocument();
      expect(getDownloadButton()).toBeEnabled();
    });

    it('sends media only, with the nested secret options off', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await fill(user, 'blue tiger river');
      await user.click(screen.getByLabelText('Include old versions'));
      await user.click(screen.getByLabelText('Secrets'));
      await user.click(screen.getByLabelText('Media library'));
      await user.click(getDownloadButton());

      await waitFor(() => expect(mockDownload).toHaveBeenCalled());
      expect(mockDownload).toHaveBeenCalledWith({
        password: 'blue tiger river',
        includeSecrets: false,
        includeAttachments: false,
        includeVersions: false,
        includeMedia: true,
      });
    });

    it('sends secrets and media together', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await fill(user, 'blue tiger river');
      await user.click(screen.getByLabelText('Media library'));
      await user.click(getDownloadButton());

      await waitFor(() => expect(mockDownload).toHaveBeenCalled());
      expect(mockDownload).toHaveBeenCalledWith({
        password: 'blue tiger river',
        includeSecrets: true,
        includeAttachments: true,
        includeVersions: false,
        includeMedia: true,
      });
    });
  });

  describe('destination', () => {
    const downloadRadio = () => screen.getByRole('radio', { name: 'Download to this device' });
    const storageRadio = () => screen.getByRole('radio', { name: 'Save to the storage account' });

    async function chooseStorage(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => expect(storageRadio()).toBeEnabled());
      await user.click(storageRadio());
    }

    it('defaults to downloading to this device', async () => {
      render(<DataBackup />);

      expect(screen.getByRole('radiogroup', { name: 'Where should the backup go?' })).toBeInTheDocument();
      expect(downloadRadio()).toBeChecked();
      expect(storageRadio()).not.toBeChecked();
      expect(getDownloadButton()).toHaveTextContent('Download backup');
      await waitFor(() => expect(storageRadio()).toBeEnabled());
      expect(screen.queryByText(BACKUP_STORAGE_NOT_CONFIGURED_HELPER)).not.toBeInTheDocument();
    });

    it('relabels the button "Save backup" when saving to storage', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await chooseStorage(user);

      expect(storageRadio()).toBeChecked();
      expect(screen.getByRole('button', { name: /save backup/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^download backup$/i })).not.toBeInTheDocument();

      await user.click(downloadRadio());
      expect(getDownloadButton()).toHaveTextContent('Download backup');
    });

    it('disables the storage option with helper text when storage is not configured', async () => {
      mockConfig.mockResolvedValue({ storageConfigured: false, keepCount: 10 });
      render(<DataBackup />);

      expect(await screen.findByText(BACKUP_STORAGE_NOT_CONFIGURED_HELPER)).toBeInTheDocument();
      expect(storageRadio()).toBeDisabled();
      expect(downloadRadio()).toBeChecked();
    });

    it('links the helper to Console → Storage only for a storage_config:read holder', async () => {
      mockConfig.mockResolvedValue({ storageConfigured: false, keepCount: 10 });
      const { unmount } = render(<DataBackup />);

      expect(await screen.findByTestId('backup-storage-helper')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Console → Storage/ })).not.toBeInTheDocument();
      unmount();

      render(<DataBackup />, {
        wrapperOptions: { user: { ...mockUser, permissions: [...mockUser.permissions, 'storage_config:read'] } },
      });
      const link = await screen.findByRole('link', { name: 'Set up storage in Console → Storage' });
      expect(link).toHaveAttribute('href', '/admin/settings/storage');
    });

    it('treats a failed config request as not configured and still downloads', async () => {
      mockConfig.mockRejectedValue(new Error('Not Found'));
      const user = userEvent.setup();
      render(<DataBackup />);

      expect(await screen.findByText(BACKUP_STORAGE_NOT_CONFIGURED_HELPER)).toBeInTheDocument();
      expect(storageRadio()).toBeDisabled();
      expect(screen.queryByText('Not Found')).not.toBeInTheDocument();

      await fill(user, 'blue tiger river');
      await user.click(getDownloadButton());

      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
      expect(mockSaveToStorage).not.toHaveBeenCalled();
    });

    it('saves to /backups/me with the password and contents, then clears the fields', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);
      await waitFor(() => expect(mockGetMyBackups).toHaveBeenCalledTimes(1));

      await fill(user, 'blue tiger river');
      await user.click(screen.getByLabelText('Include old versions'));
      await user.click(screen.getByLabelText('Media library'));
      await chooseStorage(user);
      await user.click(screen.getByRole('button', { name: /save backup/i }));

      expect(await screen.findByText(BACKUP_SAVE_STARTED_MESSAGE)).toBeInTheDocument();
      expect(mockSaveToStorage).toHaveBeenCalledTimes(1);
      expect(mockSaveToStorage).toHaveBeenCalledWith({
        password: 'blue tiger river',
        includeSecrets: true,
        includeAttachments: true,
        includeVersions: true,
        includeMedia: true,
      });
      expect(mockDownload).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      expect((getPassword() as HTMLInputElement).value).toBe('');
      expect((getConfirm() as HTMLInputElement).value).toBe('');
      expect((getPassword() as HTMLInputElement).type).toBe('password');
      // the list is reloaded so the new run shows up
      await waitFor(() => expect(mockGetMyBackups).toHaveBeenCalledTimes(2));
    });

    it('blocks saving with an invalid password', async () => {
      const user = userEvent.setup();
      render(<DataBackup />);

      await fill(user, '12345');
      await chooseStorage(user);
      await user.click(screen.getByRole('button', { name: /save backup/i }));

      expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
      expect(mockSaveToStorage).not.toHaveBeenCalled();
    });

    it('shows the server error and keeps the password when saving fails', async () => {
      mockSaveToStorage.mockRejectedValue(new Error('A backup is already running'));
      const user = userEvent.setup();
      render(<DataBackup />);

      await fill(user, 'blue tiger river');
      await chooseStorage(user);
      await user.click(screen.getByRole('button', { name: /save backup/i }));

      expect(await screen.findByText('A backup is already running')).toBeInTheDocument();
      expect(screen.queryByText(BACKUP_SAVE_STARTED_MESSAGE)).not.toBeInTheDocument();
      expect((getPassword() as HTMLInputElement).value).toBe('blue tiger river');
    });
  });

  describe('My saved backups', () => {
    const heading = () => screen.queryByRole('heading', { name: 'My saved backups' });

    it('is hidden when storage is not configured and nothing was saved', async () => {
      mockConfig.mockResolvedValue({ storageConfigured: false, keepCount: 10 });
      render(<DataBackup />);

      await screen.findByText(BACKUP_STORAGE_NOT_CONFIGURED_HELPER);
      await waitFor(() => expect(mockGetMyBackups).toHaveBeenCalled());
      expect(heading()).not.toBeInTheDocument();
    });

    it('stays visible when storage is off but saved backups exist', async () => {
      mockConfig.mockResolvedValue({ storageConfigured: false, keepCount: 10 });
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      render(<DataBackup />);

      expect(await screen.findByRole('heading', { name: 'My saved backups' })).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'My saved backups' })).toBeInTheDocument();
    });

    it('shows the empty state and the retention note when storage is configured', async () => {
      render(<DataBackup />);

      expect(await screen.findByText('No saved backups yet.')).toBeInTheDocument();
      expect(heading()).toBeInTheDocument();
      expect(screen.getByText('Keeps your 10 most recent saved backups')).toBeInTheDocument();
    });

    it('lists saved backups with status, size and contents chips', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      render(<DataBackup />);

      const table = await screen.findByRole('table', { name: 'My saved backups' });
      expect(within(table).getByText('Succeeded')).toBeInTheDocument();
      expect(within(table).getByText('4.0 KB')).toBeInTheDocument();
      const chips = within(table).getByTestId('backup-contents-mine-1');
      expect(within(chips).getByText('Secrets')).toBeInTheDocument();
      expect(within(chips).getByText('Media')).toBeInTheDocument();
      // the admin-only columns are not shown
      expect(within(table).queryByText('Trigger')).not.toBeInTheDocument();
    });

    it('downloads a saved backup through its signed URL', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      mockMyDownloadUrl.mockResolvedValue({
        url: 'https://files.example.test/mine?sig=abc',
        expiresAt: '2026-11-02T10:00:00.000Z',
        fileName: 'vault-backup-2026-11-01_090000.zip',
      });
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(await screen.findByRole('button', { name: 'Download saved backup' }));

      await waitFor(() => expect(mockStartDownload).toHaveBeenCalledTimes(1));
      expect(mockMyDownloadUrl).toHaveBeenCalledWith('mine-1');
      expect(mockStartDownload).toHaveBeenCalledWith(
        'https://files.example.test/mine?sig=abc',
        'vault-backup-2026-11-01_090000.zip',
      );
    });

    it('shows an error when the download link cannot be fetched', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      mockMyDownloadUrl.mockRejectedValue(new Error('Backup file is gone'));
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(await screen.findByRole('button', { name: 'Download saved backup' }));

      expect(await screen.findByText('Backup file is gone')).toBeInTheDocument();
      expect(mockStartDownload).not.toHaveBeenCalled();
    });

    it('disables download for a backup that is not downloadable', async () => {
      mockGetMyBackups.mockResolvedValue(
        runsPage([{ ...savedRun, status: 'failed', downloadable: false, error: 'disk full' }]),
      );
      render(<DataBackup />);

      expect(await screen.findByText('disk full')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download saved backup' })).toBeDisabled();
    });

    it('does nothing when the delete is cancelled', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(await screen.findByRole('button', { name: 'Delete saved backup' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this backup?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockDeleteMine).not.toHaveBeenCalled();
    });

    it('deletes after confirming and reloads the list', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      mockDeleteMine.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(await screen.findByRole('button', { name: 'Delete saved backup' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this backup?' });
      mockGetMyBackups.mockResolvedValue(runsPage([{ ...savedRun, deletedAt: '2026-11-02T00:00:00.000Z', downloadable: false }]));
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await screen.findByText('Backup deleted.')).toBeInTheDocument();
      expect(mockDeleteMine).toHaveBeenCalledWith('mine-1');
      expect(mockGetMyBackups).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('Deleted')).toBeInTheDocument();
    });

    it('shows an error when deleting fails', async () => {
      mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
      mockDeleteMine.mockRejectedValue(new Error('Storage refused the delete'));
      const user = userEvent.setup();
      render(<DataBackup />);

      await user.click(await screen.findByRole('button', { name: 'Delete saved backup' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this backup?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await screen.findByText('Storage refused the delete')).toBeInTheDocument();
    });

    it('cannot delete a running backup', async () => {
      mockGetMyBackups.mockResolvedValue(
        runsPage([{ ...savedRun, status: 'running', downloadable: false, finishedAt: null }]),
      );
      render(<DataBackup />);

      expect(await screen.findByRole('button', { name: 'Delete saved backup' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Download saved backup' })).toBeDisabled();
    });

    describe('polling while a saved backup is running', () => {
      const running: BackupRun = {
        ...savedRun,
        id: 'mine-2',
        status: 'running',
        finishedAt: null,
        sizeBytes: null,
        downloadable: false,
      };

      async function tick(ms: number) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      }

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('re-fetches every interval and stops once the backup settles', async () => {
        mockGetMyBackups.mockResolvedValue(runsPage([running]));
        render(<DataBackup />);
        await tick(0);

        expect(screen.getByText('Running')).toBeInTheDocument();
        expect(mockGetMyBackups).toHaveBeenCalledTimes(1);

        await tick(BACKUP_POLL_INTERVAL_MS);
        expect(mockGetMyBackups).toHaveBeenCalledTimes(2);

        mockGetMyBackups.mockResolvedValue(
          runsPage([{ ...running, status: 'succeeded', downloadable: true }]),
        );
        await tick(BACKUP_POLL_INTERVAL_MS);
        expect(mockGetMyBackups).toHaveBeenCalledTimes(3);
        expect(screen.queryByText('Running')).not.toBeInTheDocument();
        expect(screen.getByText('Succeeded')).toBeInTheDocument();

        await tick(BACKUP_POLL_INTERVAL_MS * 3);
        expect(mockGetMyBackups).toHaveBeenCalledTimes(3);
      });

      it('does not poll when nothing is running', async () => {
        mockGetMyBackups.mockResolvedValue(runsPage([savedRun]));
        render(<DataBackup />);
        await tick(0);

        await tick(BACKUP_POLL_INTERVAL_MS * 3);
        expect(mockGetMyBackups).toHaveBeenCalledTimes(1);
      });

      it('stops polling when unmounted', async () => {
        mockGetMyBackups.mockResolvedValue(runsPage([running]));
        const { unmount } = render(<DataBackup />);
        await tick(0);

        unmount();
        await tick(BACKUP_POLL_INTERVAL_MS * 3);
        expect(mockGetMyBackups).toHaveBeenCalledTimes(1);
      });

      it('blocks another save to storage while one is running', async () => {
        mockGetMyBackups.mockResolvedValue(runsPage([running]));
        render(<DataBackup />);
        await tick(0);

        act(() => {
          screen.getByRole('radio', { name: 'Save to the storage account' }).click();
        });

        expect(screen.getByRole('button', { name: /backup running/i })).toBeDisabled();
      });
    });
  });
});
