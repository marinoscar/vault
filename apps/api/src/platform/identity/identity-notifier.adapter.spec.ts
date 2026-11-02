import type { NotificationsService } from '@marinoscar/platform-api/notifications';

import { IdentityNotifierAdapter } from './identity-notifier.adapter';

describe('IdentityNotifierAdapter', () => {
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifyAddress = jest.fn().mockResolvedValue(undefined);
  let adapter: IdentityNotifierAdapter;

  beforeEach(() => {
    notify.mockClear();
    notifyAddress.mockClear();
    adapter = new IdentityNotifierAdapter({ notify, notifyAddress } as unknown as NotificationsService);
  });

  it('raises security.role_changed for the user with the before and after roles', async () => {
    const changedAt = new Date('2026-01-02T03:04:05Z').toISOString();
    await adapter.roleChanged('user-1', {
      recipientEmail: 'person-a@example.test',
      previousRoles: ['viewer'],
      currentRoles: ['contributor'],
      changedAt,
      appUrl: 'https://vault.example.test',
    } as never);

    expect(notify).toHaveBeenCalledWith('security.role_changed', 'user-1', {
      recipientEmail: 'person-a@example.test',
      previousRoles: ['viewer'],
      currentRoles: ['contributor'],
      changedAt,
      appUrl: 'https://vault.example.test',
    });
  });

  it('raises user.welcome and omits optional fields that are absent', async () => {
    await adapter.userWelcomed('user-1', { recipientEmail: 'person-a@example.test', roles: ['viewer'] } as never);

    expect(notify).toHaveBeenCalledWith('user.welcome', 'user-1', {
      recipientEmail: 'person-a@example.test',
      roles: ['viewer'],
    });
  });

  it('raises allowlist.invitation by address, because the recipient has no account yet', async () => {
    await adapter.allowlistInvitation('person-b@example.test', {
      recipientEmail: 'person-b@example.test',
      invitedBy: 'Person A',
      signInUrl: 'https://vault.example.test/login',
    } as never);

    expect(notifyAddress).toHaveBeenCalledWith('allowlist.invitation', 'person-b@example.test', {
      recipientEmail: 'person-b@example.test',
      invitedBy: 'Person A',
      signInUrl: 'https://vault.example.test/login',
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('drops an organization invitation (single-organization mode) without notifying', async () => {
    await adapter.orgInvitation('person-c@example.test', { orgName: 'Org Alpha' } as never);
    expect(notify).not.toHaveBeenCalled();
    expect(notifyAddress).not.toHaveBeenCalled();
  });
});
