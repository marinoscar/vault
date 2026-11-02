import { renderEmailTemplate } from '@marinoscar/platform-api/email';

import '../../src/app-registrations/registrations';
import '../../src/platform/notifications/notification.manifest';
import { vaultCardExpiringBrowserTemplate } from '../../src/notifications-registry/vault.notifications';

// The host renders what the package's card-expiry scan raises. The payload carries four fields and
// no card value (the scan's own spec pins that); the email and the bell must use only those.
describe('vault.card_expiring rendering', () => {
  const data = { secretId: 's1', secretName: 'Travel card', expiry: '07/2027', threshold: 7 as const };

  it('renders the email and the bell from the payload alone', () => {
    const email = renderEmailTemplate('vault-card-expiring', data);
    const bell = vaultCardExpiringBrowserTemplate(data);

    expect(email.subject).toContain('Travel card');
    expect(email.text).toContain('07/2027');
    expect(JSON.stringify({ email, bell })).not.toContain('4111');
  });
});
