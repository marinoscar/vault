import { PERMISSIONS } from '../core/roles.constants';
import { BackupNotifier } from './backup-notifier.service';

const run = (over: Record<string, unknown> = {}) =>
  ({
    id: 'run-1',
    scope: 'system',
    ownerId: null,
    trigger: 'schedule',
    startedAt: new Date('2027-01-02T03:00:00Z'),
    ...over,
  }) as never;

const finishedAt = new Date('2027-01-02T03:04:00Z');
const counts = { userCount: 2, secretCount: 5, attachmentCount: 1, mediaFileCount: 0, warningCount: 0 };

describe('BackupNotifier (issue #86)', () => {
  const make = () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifyPermissionHolders: jest.fn().mockResolvedValue(undefined) };
    return { notifications, notifier: new BackupNotifier(notifications as never) };
  };

  it('tells the holders of the backups admin permission about a system run', async () => {
    const { notifications, notifier } = make();
    await notifier.runSettled(run(), { status: 'succeeded', finishedAt, sizeBytes: 2048, counts });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyPermissionHolders).toHaveBeenCalledWith(
      'vault.backup_succeeded',
      PERMISSIONS.SYSTEM_SETTINGS_READ,
      expect.objectContaining({ runId: 'run-1', scope: 'system', trigger: 'schedule', sizeBytes: 2048, secretCount: 5 }),
    );
  });

  it('tells only the owner about a user run', async () => {
    const { notifications, notifier } = make();
    await notifier.runSettled(run({ scope: 'user', ownerId: 'user-a', trigger: 'manual' }), {
      status: 'failed',
      finishedAt,
      sizeBytes: null,
      counts: null,
      error: 'The upload to storage failed.',
    });
    expect(notifications.notifyPermissionHolders).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      'vault.backup_failed',
      'user-a',
      expect.objectContaining({ scope: 'user', trigger: 'manual', error: 'The upload to storage failed.', sizeBytes: null }),
    );
  });

  it('never throws into the run', async () => {
    const { notifications, notifier } = make();
    notifications.notifyPermissionHolders.mockRejectedValue(new Error('boom'));
    await expect(notifier.runSettled(run(), { status: 'succeeded', finishedAt, sizeBytes: 1, counts })).resolves.toBeUndefined();
  });
});
