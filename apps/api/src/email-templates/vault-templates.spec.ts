import { renderEmailTemplate } from '@marinoscar/platform-api/email';
import { findEvent } from '@marinoscar/platform-api/notifications';

import '../app-registrations/registrations';
import '../platform/notifications/notification.manifest';
import {
  VAULT_NOTIFICATIONS,
  vaultBackupFailedBrowserTemplate,
  vaultBackupSucceededBrowserTemplate,
  vaultCardExpiringBrowserTemplate,
  vaultAgentCredentialUsedBrowserTemplate,
} from '../notifications-registry/vault.notifications';
import type {
  VaultAgentCredentialChangedNotificationData,
  VaultAgentNewAppNotificationData,
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
  it('registers the events with email and browser (the agent use event: bell only), none mandatory, success off by default', () => {
    const byKey = Object.fromEntries(VAULT_NOTIFICATIONS.map((n) => [n.event.key, n.event]));
    expect(Object.keys(byKey)).toEqual([
      'vault.backup_succeeded',
      'vault.backup_failed',
      'vault.card_expiring',
      'vault.agent_credential_changed',
      'vault.agent_new_app',
      'vault.agent_credential_used',
    ]);
    for (const event of Object.values(byKey)) {
      expect(event.channels).toEqual(event.key === 'vault.agent_credential_used' ? ['browser'] : ['email', 'browser']);
      expect(event.mandatory).toBeUndefined();
      expect(findEvent(event.key)).toBeDefined();
    }
    expect(byKey['vault.agent_credential_used'].kind).toBe('counted');
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

  describe('agent notifications (E14.7)', () => {
    const SECRET = '8d1c1f0e-1111-4222-8333-444455556666';
    const changed = (
      over: Partial<VaultAgentCredentialChangedNotificationData> = {},
    ): VaultAgentCredentialChangedNotificationData => ({
      change: 'created',
      clientName: 'Agent App A',
      credentialKind: 'oauth',
      secretId: SECRET,
      secretName: 'Shop login',
      origin: 'https://shop.example.test',
      appUrl: 'https://vault.example.test',
      ...over,
    });
    const newApp = (over: Partial<VaultAgentNewAppNotificationData> = {}): VaultAgentNewAppNotificationData => ({
      clientName: 'Agent App A',
      credentialKind: 'oauth',
      secretId: SECRET,
      secretName: 'Shop login',
      origin: 'https://shop.example.test',
      appUrl: 'https://vault.example.test',
      ...over,
    });

    it('credential_changed names the app, login and website and links to the secret and the trail', () => {
      const created = renderEmailTemplate('vault-agent-credential-changed', changed());
      expect(created.subject).toContain('Agent App A saved the login Shop login for https://shop.example.test');
      expect(created.html).toContain(`https://vault.example.test/secrets/${SECRET}`);
      expect(created.html).toContain('https://vault.example.test/settings/agent-activity');
      const rotated = renderEmailTemplate('vault-agent-credential-changed', changed({ change: 'rotated' }));
      expect(rotated.subject).toContain('changed the password of the login Shop login');
    });

    it('new_app links to the trail and escapes the names', () => {
      const email = renderEmailTemplate('vault-agent-new-app', newApp({ clientName: '<b>App</b>' }));
      expect(email.html).toContain('https://vault.example.test/settings/agent-activity');
      expect(email.html).not.toContain('<b>App</b>');
    });

    it('the bell copy of the counted use event shows the folded count', () => {
      const base = { action: 'fill' as const, clientName: 'Agent App A', credentialKind: 'oauth' as const, secretId: SECRET, secretName: 'Shop login', origin: null };
      expect(vaultAgentCredentialUsedBrowserTemplate(base).body).toBe('Agent App A filled Shop login.');
      expect(vaultAgentCredentialUsedBrowserTemplate({ ...base, count: 4 }).body).toBe('Agent App A filled Shop login (4 times).');
    });
  });
});
