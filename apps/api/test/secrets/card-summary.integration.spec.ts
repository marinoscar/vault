import { randomUUID } from 'crypto';

import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock, prismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockViewerUser, authHeader, TestUser } from '../helpers/auth-mock.helper';
import { rolePermissionsMap } from '../fixtures/test-data.factory';
import { CryptoService } from '../../src/common/services/crypto.service';

const secretsRead = { id: randomUUID(), name: 'secrets:read', description: 'Read own secrets' };
const URL = '/api/secrets/cards/summary';
const FULL_PAN = '4111 1111 1111 1111';
const CVV = '734';

describe('GET /api/secrets/cards/summary (Integration)', () => {
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

  function cardRow(id: string, name: string, month: string, year: string) {
    const enc = crypto.encrypt(
      JSON.stringify({
        cardholder_name: 'Person A',
        number: FULL_PAN,
        exp_month: month,
        exp_year: year,
        cvv: CVV,
        notes: 'secret note',
      }),
    );
    return {
      id,
      name,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
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

  it('is not captured by the :id route (static route wins)', async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue([]);
    const res = await request(context.app.getHttpServer())
      .get(URL)
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('returns sorted summaries and never a CVV, full PAN or other field', async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue([
      cardRow('00000000-0000-4000-8000-000000000001', 'Late', '12', '2031'),
      cardRow('00000000-0000-4000-8000-000000000002', 'Soon', '3', '27'),
    ]);

    const res = await request(context.app.getHttpServer())
      .get(URL)
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(res.body.data.items).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Soon',
        last4: '1111',
        expMonth: 3,
        expYear: 2027,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Late',
        last4: '1111',
        expMonth: 12,
        expYear: 2031,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(CVV);
    expect(raw).not.toContain(FULL_PAN);
    expect(raw).not.toContain('4111111111111111');
    expect(raw).not.toContain('Person A');
    expect(raw).not.toContain('secret note');
    expect(raw).not.toMatch(/cvv|encryptedData|authTag/i);
  });

  it("queries only the caller's own Card secrets (foreign cards are never selected)", async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue([]);

    await request(context.app.getHttpServer()).get(URL).set(authHeader(user.accessToken)).expect(200);

    const where = prismaMock.secret.findMany.mock.calls[0][0].where;
    expect(where.createdById).toBe(user.id);
    expect(where.type).toEqual({ isSystem: true, name: 'Card' });
  });

  it('paginates and rejects an invalid page size', async () => {
    const user = await userWithSecretsRead();
    prismaMock.secret.findMany.mockResolvedValue(
      ['1', '2', '3'].map((m) => cardRow(`00000000-0000-4000-8000-00000000000${m}`, `C${m}`, m, '2030')),
    );

    const res = await request(context.app.getHttpServer())
      .get(`${URL}?page=2&pageSize=2`)
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.meta).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });

    await request(context.app.getHttpServer())
      .get(`${URL}?pageSize=1000`)
      .set(authHeader(user.accessToken))
      .expect(400);
  });
});
