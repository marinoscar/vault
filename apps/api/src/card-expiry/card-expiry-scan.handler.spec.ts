import { renderEmailTemplate } from '@marinoscar/platform-api/email';

import '../app-registrations/registrations';
import '../platform/notifications/notification.manifest';
import { vaultCardExpiringBrowserTemplate } from '../notifications-registry/vault.notifications';
import { CardExpiryScanHandler } from './card-expiry-scan.handler';

// Distinctive values in every field of the card. None may appear in anything the scan raises.
const MARKERS = {
  number: '4111999988887777',
  last4: '7777',
  cvv: 'CVV-MARKER-913',
  holder: 'HOLDER-MARKER-ZED',
  code2: 'CID-MARKER-552',
  notes: 'NOTES-MARKER-quartz',
  bank: 'BANK-MARKER-orchid',
};

const card = (over: Record<string, string> = {}) => ({
  card_network: 'visa',
  cardholder_name: MARKERS.holder,
  number: MARKERS.number,
  exp_month: '07',
  exp_year: '2027',
  cvv: MARKERS.cvv,
  security_code_2: MARKERS.code2,
  issuing_bank: MARKERS.bank,
  notes: MARKERS.notes,
  ...over,
});

function build(cards: Array<{ id: string; name: string; owner: string | null; values: unknown }>, audit: unknown[] = []) {
  const notifyNow = jest.fn().mockResolvedValue({});
  const auditCreate = jest.fn().mockResolvedValue({});
  let served = false;
  const prisma = {
    secretType: { findFirst: jest.fn().mockResolvedValue({ id: 'type-card' }) },
    secret: {
      findMany: jest.fn().mockImplementation(async () => {
        if (served) return [];
        served = true;
        return cards.map((c) => ({
          id: c.id,
          name: c.name,
          createdById: c.owner,
          versions: [{ encryptedData: JSON.stringify(c.values), iv: 'iv', authTag: 'tag' }],
        }));
      }),
    },
    auditEvent: { findMany: jest.fn().mockResolvedValue(audit), create: auditCreate },
  };
  const crypto = { decrypt: (data: string) => data };
  const handler = new CardExpiryScanHandler(
    { register: jest.fn() } as never,
    prisma as never,
    crypto as never,
    { notifyNow } as never,
  );
  return { handler, notifyNow, auditCreate };
}

const markersIn = (text: string) => Object.values(MARKERS).filter((marker) => text.includes(marker));

describe('CardExpiryScanHandler (issue #86)', () => {
  it('notifies the owner at the threshold with the name and MM/YYYY only', async () => {
    const { handler, notifyNow, auditCreate } = build([
      { id: 's1', name: 'Travel card', owner: 'u1', values: card() },
    ]);

    const result = await handler.scan(new Date('2027-07-24T08:00:00Z')); // 7 days to 2027-07-31

    expect(result).toEqual({ scanned: 1, notified: 1, unreadable: 0 });
    expect(notifyNow).toHaveBeenCalledTimes(1);
    const [event, userId, data] = notifyNow.mock.calls[0];
    expect(event).toBe('vault.card_expiring');
    expect(userId).toBe('u1');
    expect(data).toMatchObject({ secretId: 's1', secretName: 'Travel card', expiry: '07/2027', threshold: 7 });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'vault.card.expiry_notified',
        targetType: 'secret',
        targetId: 's1',
        meta: { threshold: 7, expiry: '07/2027' },
      }),
    });
  });

  it('carries no card field value in the payload, the record, the email or the bell text', async () => {
    const { handler, notifyNow, auditCreate } = build([{ id: 's1', name: 'Travel card', owner: 'u1', values: card() }]);
    await handler.scan(new Date('2027-07-31T08:00:00Z'));

    const [, , data] = notifyNow.mock.calls[0];
    const email = renderEmailTemplate('vault-card-expiring', data);
    const bell = vaultCardExpiringBrowserTemplate(data);
    const everything = JSON.stringify({ data, audit: auditCreate.mock.calls, email, bell });

    expect(markersIn(everything)).toEqual([]);
    expect(everything).not.toContain('4111');
    expect(Object.keys(data).filter((key) => key !== 'appUrl').sort()).toEqual(['expiry', 'secretId', 'secretName', 'threshold']);
    expect(email.subject).toContain('Travel card');
    expect(email.text).toContain('07/2027');
  });

  it('skips a threshold already recorded for the same expiry, but not for a renewed card', async () => {
    const recorded = [{ targetId: 's1', meta: { threshold: 7, expiry: '07/2027' } }];
    const same = build([{ id: 's1', name: 'Travel card', owner: 'u1', values: card() }], recorded);
    await same.handler.scan(new Date('2027-07-24T08:00:00Z'));
    expect(same.notifyNow).not.toHaveBeenCalled();

    const renewed = build(
      [{ id: 's1', name: 'Travel card', owner: 'u1', values: card({ exp_year: '2028' }) }],
      recorded,
    );
    await renewed.handler.scan(new Date('2028-07-24T08:00:00Z'));
    expect(renewed.notifyNow).toHaveBeenCalledTimes(1);
  });

  it('ignores cards that are far off, expired, ownerless or unparseable', async () => {
    const { handler, notifyNow } = build([
      { id: 'far', name: 'Far', owner: 'u1', values: card({ exp_year: '2030' }) },
      { id: 'old', name: 'Old', owner: 'u1', values: card({ exp_year: '2020' }) },
      { id: 'orphan', name: 'Orphan', owner: null, values: card() },
      { id: 'bad', name: 'Bad', owner: 'u1', values: card({ exp_month: '13' }) },
    ]);
    const result = await handler.scan(new Date('2027-07-24T08:00:00Z'));
    expect(notifyNow).not.toHaveBeenCalled();
    expect(result.notified).toBe(0);
  });

  it('counts an undecryptable version, logs only the secret id, and fails the job when none is readable', async () => {
    const { handler } = build([{ id: 's1', name: 'Travel card', owner: 'u1', values: card() }]);
    (handler as unknown as { crypto: { decrypt: () => never } }).crypto = {
      decrypt: () => {
        throw new Error(`bad key ${MARKERS.number}`);
      },
    };
    const warn = jest.spyOn(
      (handler as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );
    await expect(handler.process({} as never)).rejects.toThrow('No card could be read');
    expect(markersIn(JSON.stringify(warn.mock.calls))).toEqual([]);
    expect(JSON.stringify(warn.mock.calls)).toContain('s1');
  });
});
