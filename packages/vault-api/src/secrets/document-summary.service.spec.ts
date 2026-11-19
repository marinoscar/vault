import { documentSummaryResponseSchema } from '@marinoscar/vault-contract/secrets';

import { DocumentSummaryService, summarizeDocumentData } from './document-summary.service';
import { PERMISSIONS } from '../core/roles.constants';
import { SecretsController } from './secrets.controller';

const CANARY = { number: 'DOCNUM-CANARY-7731', dob: '1911-11-11', holder: 'HOLDER-CANARY-Person-B' };

describe('summarizeDocumentData (IDOC-9)', () => {
  it('reads only the kind and the expiry date', () => {
    expect(
      summarizeDocumentData('ID Document', {
        document_kind: 'Visa',
        expiry_date: '2030-01-31',
        document_number: CANARY.number,
        date_of_birth: CANARY.dob,
        holder_name: CANARY.holder,
      }),
    ).toEqual({ documentKind: 'Visa', expiryDate: '2030-01-31' });
  });

  it('drops a kind outside the catalog, a passport kind and an invalid date', () => {
    expect(summarizeDocumentData('ID Document', { document_kind: CANARY.holder, expiry_date: 'soon' })).toEqual({
      documentKind: null,
      expiryDate: null,
    });
    expect(summarizeDocumentData('Passport', { document_kind: 'Visa', expiry_date: '2030-01-31' })).toEqual({
      documentKind: null,
      expiryDate: '2030-01-31',
    });
    expect(summarizeDocumentData('Passport', null)).toEqual({ documentKind: null, expiryDate: null });
  });
});

describe('DocumentSummaryService (IDOC-9)', () => {
  const now = new Date('2027-01-01T12:00:00Z');
  let findMany: jest.Mock;
  let service: DocumentSummaryService;

  const row = (id: string, name: string, typeName: string, data: unknown) => ({
    id,
    name,
    type: { name: typeName },
    versions: data === undefined ? [] : [{ encryptedData: JSON.stringify(data), iv: 'iv', authTag: 'tag' }],
  });

  beforeEach(() => {
    findMany = jest.fn();
    const decrypt = jest.fn((c: string) => {
      if (c === '"BAD"') throw new Error('auth failed');
      return c;
    });
    service = new DocumentSummaryService({ secret: { findMany } } as never, { decrypt } as never);
  });

  it('asks only for the caller\'s own Passport and ID Document secrets', async () => {
    findMany.mockResolvedValue([]);
    await service.list('u1', now);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdById: 'u1', type: { isSystem: true, name: { in: ['Passport', 'ID Document'] } } },
      }),
    );
  });

  it('classifies, sorts soonest first (no expiry last) and returns no sensitive field', async () => {
    const pii = { document_number: CANARY.number, passport_number: CANARY.number, date_of_birth: CANARY.dob, holder_name: CANARY.holder, surname: CANARY.holder };
    findMany.mockResolvedValue([
      row('valid', 'Passport Z', 'Passport', { ...pii, expiry_date: '2030-01-01' }),
      row('soon', 'Passport Y', 'Passport', { ...pii, expiry_date: '2027-06-01' }), // within 270 days
      row('expired', 'License', 'ID Document', { ...pii, document_kind: 'Driver License', expiry_date: '2026-12-31' }),
      row('ssn', 'SSN', 'ID Document', { ...pii, document_kind: 'Social Security Card' }),
      row('visa', 'Visa', 'ID Document', { ...pii, document_kind: 'Visa', expiry_date: '2027-05-01' }), // 120 days > 90
      { ...row('broken', 'Broken', 'Passport', {}), versions: [{ encryptedData: '"BAD"', iv: 'i', authTag: 't' }] },
      row('custom', 'Not a document', 'Card', { expiry_date: '2027-01-02' }),
    ]);

    const res = await service.list('u1', now);

    expect(documentSummaryResponseSchema.parse(res)).toEqual(res);
    expect(res.items.map((i) => [i.id, i.status])).toEqual([
      ['expired', 'expired'],
      ['visa', 'valid'],
      ['soon', 'expiring_soon'],
      ['valid', 'valid'],
      ['broken', 'no_expiry'],
      ['ssn', 'no_expiry'],
    ]);
    expect(res.items[0]).toEqual({
      id: 'expired',
      name: 'License',
      typeName: 'ID Document',
      documentKind: 'Driver License',
      expiryDate: '2026-12-31',
      status: 'expired',
    });
    const text = JSON.stringify(res);
    for (const value of Object.values(CANARY)) expect(text).not.toContain(value);
  });
});

describe('GET /secrets/documents/summary', () => {
  it('requires secrets:read and passes only the caller id', async () => {
    const list = jest.fn().mockResolvedValue({ items: [] });
    const controller = new SecretsController({} as never, {} as never, {} as never, { list } as never);
    const auth = Reflect.getMetadata('permissions', SecretsController.prototype.documentSummary);
    // `@Auth` stores its options; whichever key it uses, `secrets:read` is the one permission named.
    const metadataKeys = Reflect.getMetadataKeys(SecretsController.prototype.documentSummary);
    const all = metadataKeys.map((key) => Reflect.getMetadata(key, SecretsController.prototype.documentSummary));
    expect(JSON.stringify(auth ?? all)).toContain(PERMISSIONS.SECRETS_READ);
    expect(JSON.stringify(all)).not.toContain('secrets:read_any');

    await expect(controller.documentSummary({ id: 'u1', permissions: [PERMISSIONS.SECRETS_READ_ANY] } as never)).resolves.toEqual({
      data: { items: [] },
    });
    expect(list).toHaveBeenCalledWith('u1');
  });
});
