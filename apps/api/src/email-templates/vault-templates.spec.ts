import { renderEmailTemplate } from '@marinoscar/platform-api/email';
import { findEvent } from '@marinoscar/platform-api/notifications';

import '../app-registrations/registrations';
import '../platform/notifications/notification.manifest';
import {
  VAULT_NOTIFICATIONS,
  vaultBackupFailedBrowserTemplate,
  vaultBackupSucceededBrowserTemplate,
  vaultCardExpiringBrowserTemplate,
} from '../notifications-registry/vault.notifications';
import type {
  VaultBackupNotificationData,
  VaultCardExpiringNotificationData,
} from '@marinoscar/vault-api/core';

const backup = (over: Partial<VaultBackupNotificationData> = {}): VaultBackupNotificationData => ({
  runId: 'run-1',
  scope: 'system',
  trigger: 'schedule',
  startedAt: '2027-01-02T03:00:00.000Z',
  finishedAt: '2027-01-02T03:04:00.000Z',
  sizeBytes: 1_572_864,
  secretCount: 12,
  attachmentCount: 3,
  mediaFileCount: 0,
  warningCount: 0,
  appUrl: 'https://vault.example.test/',
  ...over,
});

const expiring = (over: Partial<VaultCardExpiringNotificationData> = {}): VaultCardExpiringNotificationData => ({
  secretId: '8d1c1f0e-1111-4222-8333-444455556666',
  secretName: 'Travel card',
  expiry: '07/2027',
  threshold: 7,
  appUrl: 'https://vault.example.test',
  ...over,
});

describe('Vault notification events and templates (issue #86)', () => {
  it('registers the three events with email and browser, none mandatory, success off by default', () => {
    const byKey = Object.fromEntries(VAULT_NOTIFICATIONS.map((n) => [n.event.key, n.event]));
    expect(Object.keys(byKey)).toEqual(['vault.backup_succeeded', 'vault.backup_failed', 'vault.card_expiring']);
    for (const event of Object.values(byKey)) {
      expect(event.channels).toEqual(['email', 'browser']);
      expect(event.mandatory).toBeUndefined();
      expect(findEvent(event.key)).toBeDefined();
    }
    expect(byKey['vault.backup_succeeded'].defaultEnabled).toBe(false);
    expect(byKey['vault.backup_failed'].defaultEnabled).toBe(true);
    expect(byKey['vault.card_expiring'].defaultEnabled).toBe(true);
  });

  describe('vault-backup-succeeded', () => {
    it('names the scope, time, size and counts, and links to the right page', () => {
      const system = renderEmailTemplate('vault-backup-succeeded', backup());
      expect(system.subject).toContain('scheduled system backup completed');
      expect(system.text).toContain('1.5 MB');
      expect(system.text).toContain('12 secrets, 3 attachments');
      expect(system.html).toContain('https://vault.example.test/admin/settings/backups');

      const mine = renderEmailTemplate('vault-backup-succeeded', backup({ scope: 'user', trigger: 'manual' }));
      expect(mine.html).toContain('https://vault.example.test/settings/backups');
      expect(mine.subject).toContain('your saved backup completed');
    });

    it('renders the bell and push copy with the deep link', () => {
      expect(vaultBackupSucceededBrowserTemplate(backup({ scope: 'user' }))).toEqual({
        title: 'Backup completed',
        body: 'Your saved backup: 12 secrets, 3 attachments, 1.5 MB.',
        link: '/settings/backups',
      });
    });
  });

  describe('vault-backup-failed', () => {
    it('shows the static reason and nothing else about the failure', () => {
      const email = renderEmailTemplate('vault-backup-failed', backup({ sizeBytes: null, error: 'The upload to storage failed.' }));
      expect(email.subject).toContain('failed');
      expect(email.text).toContain('The upload to storage failed.');
      expect(vaultBackupFailedBrowserTemplate(backup({ error: 'The upload to storage failed.' }))).toMatchObject({
        title: 'Backup failed',
        link: '/admin/settings/backups',
      });
    });

    it('escapes markup in the reason', () => {
      const email = renderEmailTemplate('vault-backup-failed', backup({ error: '<script>x()</script>' }));
      expect(email.html).not.toContain('<script>x()');
      expect(email.html).toContain('&lt;script&gt;');
    });

    it('falls back to the deployment base URL when the payload carries none', () => {
      const email = renderEmailTemplate('vault-backup-failed', backup({ appUrl: undefined, error: 'x' }));
      expect(email.html).toContain('/admin/settings/backups');
    });
  });

  describe('vault-card-expiring', () => {
    it.each([
      [30, 'expires in 30 days (07/2027)'],
      [7, 'expires in 7 days (07/2027)'],
      [0, 'expires today (07/2027)'],
    ] as const)('threshold %i reads "%s"', (threshold, phrase) => {
      const email = renderEmailTemplate('vault-card-expiring', expiring({ threshold }));
      expect(email.subject).toContain(phrase);
      expect(email.text).toContain(phrase);
      expect(vaultCardExpiringBrowserTemplate(expiring({ threshold })).body).toBe(`Travel card ${phrase}.`);
    });

    it('links to the secret and escapes the name', () => {
      const email = renderEmailTemplate('vault-card-expiring', expiring({ secretName: '<b>Mine</b> & "co"' }));
      expect(email.html).toContain('https://vault.example.test/secrets/8d1c1f0e-1111-4222-8333-444455556666');
      expect(email.html).not.toContain('<b>Mine</b>');
      expect(vaultCardExpiringBrowserTemplate(expiring()).link).toBe('/secrets/8d1c1f0e-1111-4222-8333-444455556666');
    });
  });
});
