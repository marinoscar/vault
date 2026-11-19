import { randomUUID } from 'crypto';

import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock, prismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockViewerUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { rolePermissionsMap } from '../fixtures/test-data.factory';
import { CryptoService } from '../../src/common/services/crypto.service';

// IDOC-9: the Home panel's source. Own documents only; the kind and the expiry date are the only
// facts read from a decrypted version.

const secretsRead = { id: randomUUID(), name: 'secrets:read', description: 'Read own secrets' };
const URL = '/api/secrets/documents/summary';
const CANARY = { number: 'DOCNUM-CANARY-4410', dob: '1911-11-11', holder: 'HOLDER-CANARY-Person-A', mrz: 'P<UTOCANARY' };

describe('GET /api/secrets/documents/summary (Integration, IDOC-9)', () => {
  let context: TestContext;
  let crypto: CryptoService;
  let originalViewer: typeof rolePermissionsMap.viewer;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    crypto = context.app.get(CryptoService);
    // The test app may boot without VAULT_ENCRYPTION_KEY; install a test key.
    if (!(crypto as any).encryptionKey) {
      (crypto as any).encryptionKey = Buffer.alloc(32, 7);
    }
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    originalViewer = rolePermissionsMap.viewer;
    setupBaseMocks();
  });

  afterEach(() => {
    rolePermissionsMap.viewer = originalViewer;
  });

  async function userWithSecretsRead(): Promise<TestUser> {
    rolePermissionsMap.viewer = [...originalViewer, secretsRead] as any;
    return createMockViewerUser(context);
  }

  function documentRow(id: string, name: string, typeName: string, values: Record<string, unknown>) {
    const enc = crypto.encrypt(
      JSON.stringify({
        holder_name: CANARY.holder,
        surname: CANARY.holder,
        document_number: CANARY.number,
        passport_number: CANARY.number,
        date_of_birth: CANARY.dob,
        mrz: CANARY.mrz,
        ...values,
      }),
    );
    return {
      id,
      name,
      type: { name: typeName },
      versions: [{ encryptedData: enc.ciphertext, iv: enc.iv, authTag: enc.authTag }],
    };
  }

  it('returns 401 when unauthenticated', async () => {
    await request(context.app.getHttpServer()).get(URL).expect(401);
  });

  it('returns 403 without secrets:read', async () => {
    const viewer = await createMockViewerUser(context);
    await request(context.app.getHttpServer()).get(URL).set(authHeader(viewer.accessToken)).expect(403);
    expect(prismaMock.secret.findMany).not.toHaveBeenCalled();
  });

  it('asks only for the caller\'s own documents (foreign secrets excluded)', async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue([]);

    const res = await request(context.app.getHttpServer()).get(URL).set(authHeader(user.accessToken)).expect(200);

    expect(res.body.data).toEqual({ items: [] });
    expect(prismaMock.secret.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdById: user.id, type: { isSystem: true, name: { in: ['Passport', 'ID Document'] } } },
      }),
    );
  });

  it('returns the status per document and never a number, date of birth, holder or MRZ', async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue([
      documentRow('00000000-0000-4000-8000-000000000001', 'Passport A', 'Passport', { expiry_date: '2099-01-01' }),
      documentRow('00000000-0000-4000-8000-000000000002', 'License A', 'ID Document', {
        document_kind: 'Driver License',
        expiry_date: '2001-01-01',
      }),
    ]);

    const res = await request(context.app.getHttpServer()).get(URL).set(authHeader(user.accessToken)).expect(200);

    expect(res.body.data.items).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'License A',
        typeName: 'ID Document',
        documentKind: 'Driver License',
        expiryDate: '2001-01-01',
        status: 'expired',
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Passport A',
        typeName: 'Passport',
        documentKind: null,
        expiryDate: '2099-01-01',
        status: 'valid',
      },
    ]);
    const body = JSON.stringify(res.body);
    for (const value of Object.values(CANARY)) expect(body).not.toContain(value);
  });
});
