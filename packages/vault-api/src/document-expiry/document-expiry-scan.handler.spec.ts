import { DocumentExpiryScanHandler } from './document-expiry-scan.handler';
import { InMemoryAudit, RecordingNotify, TestCrypto } from '../testing';

// Canary values in every identifying field. None may appear in anything the scan raises or logs.
const MARKERS = {
  number: 'DOCNUM-CANARY-X93104',
  dob: '1911-11-11',
  holder: 'HOLDER-CANARY-Person-A',
  mrz: 'MRZ-CANARY-P<UTO',
  notes: 'NOTES-CANARY-quartz',
  personal: 'PERSONAL-CANARY-551',
};

const passport = (over: Record<string, unknown> = {}) => ({
  surname: MARKERS.holder,
  given_names: 'Person A',
  passport_number: MARKERS.number,
  issuing_country: 'UTO',
  date_of_birth: MARKERS.dob,
  expiry_date: '2027-07-10',
  personal_number: MARKERS.personal,
  mrz: MARKERS.mrz,
  notes: MARKERS.notes,
  ...over,
});

const idDocument = (kind: string, over: Record<string, unknown> = {}) => ({
  document_kind: kind,
  holder_name: MARKERS.holder,
  document_number: MARKERS.number,
  date_of_birth: MARKERS.dob,
  expiry_date: '2027-07-10',
  attributes: { mrz: MARKERS.mrz },
  notes: MARKERS.notes,
  ...over,
});

interface Doc {
  id: string;
  name: string;
  type: 'Passport' | 'ID Document';
  owner: string | null;
  /** `false`: the owner is deactivated (the query filters it out). */
  active?: boolean;
  values: unknown;
  /** Corrupt ciphertext. */
  broken?: boolean;
}

const TYPE_IDS = { Passport: 'type-passport', 'ID Document': 'type-id-document' } as const;

function build(docs: Doc[], audit = new InMemoryAudit()) {
  const crypto = new TestCrypto();
  const notify = new RecordingNotify();
  const prisma = {
    secretType: {
      findMany: jest.fn().mockResolvedValue([
        { id: TYPE_IDS.Passport, name: 'Passport' },
        { id: TYPE_IDS['ID Document'], name: 'ID Document' },
      ]),
    },
    secret: {
      findMany: jest.fn().mockImplementation(async (args: { where: { createdBy: { isActive: boolean } }; cursor?: unknown }) => {
        if (args.cursor) return [];
        return docs
          .filter((doc) => (doc.active ?? true) === args.where.createdBy.isActive)
          .map((doc) => {
            const sealed = crypto.encrypt(JSON.stringify(doc.values));
            return {
              id: doc.id,
              name: doc.name,
              typeId: TYPE_IDS[doc.type],
              createdById: doc.owner,
              versions: [
                {
                  encryptedData: doc.broken ? 'AAAA' : sealed.ciphertext,
                  iv: sealed.iv,
                  authTag: sealed.authTag,
                },
              ],
            };
          });
      }),
    },
    // The dedup read: the rows the audit port recorded.
    auditEvent: {
      findMany: jest.fn().mockImplementation(async () =>
        audit.events.map((event) => ({ targetId: event.targetId, meta: event.meta })),
      ),
    },
  };
  const handler = new DocumentExpiryScanHandler(
    { registerHandler: jest.fn() } as never,
    prisma as never,
    crypto,
    notify as never,
    audit,
    { appUrl: 'https://vault.example.test' } as never,
  );
  return { handler, notify, audit, prisma };
}

const markersIn = (text: string) => Object.values(MARKERS).filter((marker) => text.includes(marker));

describe('DocumentExpiryScanHandler (IDOC-9)', () => {
  it('declares a permanent, server-only job type', () => {
    const { handler } = build([]);
    expect(handler.type).toBe('vault.documents.expiry_scan');
    expect(handler.profile).toEqual({ maxRuntimeMs: 15 * 60_000, maxAttempts: 2 });
    expect((handler as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((handler as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
  });

  it('notifies a passport owner at a lead day with the right event, payload and audit row', async () => {
    const { handler, notify, audit } = build([
      { id: 's1', name: 'Passport A', type: 'Passport', owner: 'u1', values: passport() },
    ]);

    const result = await handler.scan(new Date('2027-04-11T08:00:00Z')); // 90 days to 2027-07-10

    expect(result).toEqual({ scanned: 1, notified: 1, unreadable: 0 });
    expect(notify.sent).toEqual([
      {
        event: 'vault.document_expiring',
        target: 'u1',
        data: {
          secretId: 's1',
          secretName: 'Passport A',
          documentLabel: 'Passport',
          expiry: '2027-07-10',
          daysLeft: 90,
          threshold: 90,
          appUrl: 'https://vault.example.test',
        },
      },
    ]);
    expect(audit.events).toEqual([
      {
        action: 'vault.document.expiry_notified',
        targetType: 'secret',
        targetId: 's1',
        meta: { threshold: 90, expiry: '2027-07-10' },
      },
    ]);
  });

  it('labels an ID Document by its catalog kind, and an unknown kind as "ID Document"', async () => {
    const { handler, notify } = build([
      { id: 's1', name: 'License', type: 'ID Document', owner: 'u1', values: idDocument('Driver License') },
      { id: 's2', name: 'Odd', type: 'ID Document', owner: 'u1', values: idDocument(MARKERS.holder) },
    ]);
    await handler.scan(new Date('2027-07-03T08:00:00Z')); // 7 days

    expect(notify.sent.map((n) => (n.data as { documentLabel: string }).documentLabel)).toEqual([
      'Driver License',
      'ID Document',
    ]);
  });

  it('never puts the document number, date of birth, holder name or MRZ in a payload, audit row or log', async () => {
    const { handler, notify, audit } = build([
      { id: 's1', name: 'Passport A', type: 'Passport', owner: 'u1', values: passport() },
      { id: 's2', name: 'Card B', type: 'ID Document', owner: 'u1', values: idDocument('Permanent Resident Card') },
      { id: 's3', name: 'Broken', type: 'Passport', owner: 'u1', values: passport(), broken: true },
    ]);
    const logger = (handler as unknown as { logger: { log: (m: string) => void; warn: (m: string) => void } }).logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await handler.scan(new Date('2027-07-10T08:00:00Z'));

    const everything = JSON.stringify({ sent: notify.sent, audit: audit.events, log: log.mock.calls, warn: warn.mock.calls });
    expect(notify.sent).toHaveLength(2);
    expect(markersIn(everything)).toEqual([]);
    for (const { data } of notify.sent) {
      expect(Object.keys(data as object).sort()).toEqual(
        ['appUrl', 'daysLeft', 'documentLabel', 'expiry', 'secretId', 'secretName', 'threshold'],
      );
    }
  });

  it('notifies once for skipped lead days, never repeats, and restarts for a renewed document', async () => {
    const audit = new InMemoryAudit();
    const first = build([{ id: 's1', name: 'Passport A', type: 'Passport', owner: 'u1', values: passport() }], audit);
    // Saved 20 days before expiry: 270, 180, 90 and 30 are all past; one message, for 30.
    await first.handler.scan(new Date('2027-06-20T08:00:00Z'));
    await first.handler.scan(new Date('2027-06-21T08:00:00Z'));
    expect(first.notify.sent.map((n) => (n.data as { threshold: number }).threshold)).toEqual([30]);

    const renewed = build(
      [{ id: 's1', name: 'Passport A', type: 'Passport', owner: 'u1', values: passport({ expiry_date: '2037-07-10' }) }],
      audit,
    );
    await renewed.handler.scan(new Date('2036-10-13T08:00:00Z')); // 270 days to the new expiry
    expect(renewed.notify.sent.map((n) => (n.data as { threshold: number; expiry: string }))).toEqual([
      expect.objectContaining({ threshold: 270, expiry: '2037-07-10' }),
    ]);
  });

  it('skips inactive owners, ownerless secrets, Social Security cards and documents with no or an invalid expiry', async () => {
    const { handler, notify, prisma } = build([
      { id: 'inactive', name: 'Gone', type: 'Passport', owner: 'u2', active: false, values: passport() },
      { id: 'orphan', name: 'Orphan', type: 'Passport', owner: null, values: passport() },
      { id: 'ssn', name: 'SSN', type: 'ID Document', owner: 'u1', values: idDocument('Social Security Card') },
      { id: 'none', name: 'No expiry', type: 'ID Document', owner: 'u1', values: idDocument('Visa', { expiry_date: '' }) },
      { id: 'bad', name: 'Bad expiry', type: 'Passport', owner: 'u1', values: passport({ expiry_date: '2027-02-30' }) },
    ]);

    const result = await handler.scan(new Date('2027-07-10T08:00:00Z'));

    expect(notify.sent).toEqual([]);
    expect(result.notified).toBe(0);
    expect(prisma.secret.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdBy: { isActive: true } }) }),
    );
  });

  it('counts unreadable versions and fails the job only when none is readable', async () => {
    const mixed = build([
      { id: 's1', name: 'Passport A', type: 'Passport', owner: 'u1', values: passport() },
      { id: 's2', name: 'Broken', type: 'Passport', owner: 'u1', values: passport(), broken: true },
    ]);
    jest.spyOn((mixed.handler as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    expect(await mixed.handler.scan(new Date('2027-07-10T08:00:00Z'))).toEqual({ scanned: 2, notified: 1, unreadable: 1 });
    await expect(mixed.handler.process({} as never)).resolves.toBeUndefined();

    const allBroken = build([{ id: 's2', name: 'Broken', type: 'Passport', owner: 'u1', values: passport(), broken: true }]);
    const warn = jest
      .spyOn((allBroken.handler as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    await expect(allBroken.handler.process({} as never)).rejects.toThrow('No document could be read');
    expect(JSON.stringify(warn.mock.calls)).toContain('s2');
  });
});
