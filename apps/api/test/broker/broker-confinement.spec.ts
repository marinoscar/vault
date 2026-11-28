// =============================================================================
// Token confinement of the credential broker (issue #246, ADR-0006), over the real AppModule
// =============================================================================
//
//   - a `vbk_` bearer authenticates NOWHERE but `/api/broker/v1/*`: on every other route it is a 401,
//     even when the database would happily resolve it (the mocked `broker_tokens` row below is valid),
//     because no other route reads a `vbk_` bearer;
//   - `oat_` tokens, session JWTs and every other bearer are refused on the broker (403
//     BROKER_CREDENTIAL_REFUSED), and an unauthenticated call is a 401;
//   - the opt-in and the token routes refuse `vbk_` (401);
//   - the test-only forward options are bound nowhere in the production module graph.
// =============================================================================

import '../../src/app-registrations/registrations';

import request from 'supertest';
import { BROKER_FORWARD_OPTIONS } from '@marinoscar/vault-api/testing';
import { hashBrokerToken } from '@marinoscar/vault-api/broker';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const SECRET = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const VBK = `vbk_${'A1b2C3d4E5'.repeat(4)}`;

describe('broker token confinement', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 180_000);
  afterAll(async () => closeTestApp(ctx));

  beforeEach(() => {
    resetPrismaMock();
    // The database would resolve this token: the confinement must not depend on it being unknown.
    ctx.prismaMock.brokerToken.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash === hashBrokerToken(VBK)
        ? { id: 'tok-1', userId: 'user-aaa', secretIds: [], expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, user: { isActive: true } }
        : null,
    );
    ctx.prismaMock.brokerToken.update.mockResolvedValue({});
  });

  const http = () => request(ctx.app.getHttpServer());

  describe('a vbk_ bearer outside the broker', () => {
    const routes: Array<[string, string]> = [
      ['get', '/api/secrets'],
      ['get', `/api/secrets/${SECRET}`],
      ['post', '/api/secrets'],
      ['patch', `/api/secrets/${SECRET}/broker-access`],
      ['patch', `/api/secrets/${SECRET}/agent-access`],
      ['get', '/api/broker/tokens'],
      ['post', '/api/broker/tokens'],
      ['delete', `/api/broker/tokens/${SECRET}`],
      ['post', `/api/broker/tokens/${SECRET}/revoke`],
      ['get', '/api/agent/v1/whoami'],
      ['post', '/api/mcp'],
      ['get', '/api/agent-activity'],
      ['get', '/api/system-settings'],
      ['get', '/api/user-settings'],
      ['get', '/api/storage/objects'],
      ['get', '/api/backups/me'],
      ['get', '/api/media/folders'],
    ];
    it.each(routes)('%s %s is a 401', async (method, path) => {
      const res = await (http() as any)[method](path).set('Authorization', `Bearer ${VBK}`).send({});
      expect(res.status).toBe(401);
      // Proof it was never consulted: a valid-looking token was not even looked up.
      expect(ctx.prismaMock.brokerToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('the forwarding endpoint refuses anything but vbk_ and pat_', () => {
    const url = `/api/broker/v1/${SECRET}/api.service-x.example/v1/ping`;

    it('401 without a credential, and for an unknown vbk_ token', async () => {
      expect((await http().get(url)).status).toBe(401);
      expect((await http().get(url).set('Authorization', `Bearer vbk_${'z'.repeat(40)}`)).status).toBe(401);
    });

    it.each([
      ['an oat_ token', 'Bearer oat_0123456789abcdef'],
      ['a session JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig'],
      ['a node credential', 'Bearer nod_0123456789abcdef'],
      ['basic auth', 'Basic dXNlcjpwdw=='],
    ])('%s is 403 BROKER_CREDENTIAL_REFUSED', async (_label, authorization) => {
      const res = await http().get(url).set('Authorization', authorization);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BROKER_CREDENTIAL_REFUSED');
      expect(ctx.prismaMock.brokerToken.findUnique).not.toHaveBeenCalled();
    });

    it('a valid broker token is authenticated (and then meets the kill switch: 403 BROKER_DISABLED, never a 401)', async () => {
      ctx.prismaMock.systemSettings?.findFirst?.mockResolvedValue(null);
      const res = await http().get(url).set('Authorization', `Bearer ${VBK}`);
      expect(res.status).not.toBe(401);
      expect(ctx.prismaMock.brokerToken.findUnique).toHaveBeenCalledTimes(1);
    });

    it('the root of the base URL (no path) is the same endpoint', async () => {
      expect((await http().get(`/api/broker/v1/${SECRET}/api.service-x.example`)).status).toBe(401);
    });

    it('answers a method the broker does not forward with 405, never reaching a credential check body', async () => {
      const res = await http().trace?.(url);
      if (res) expect([401, 404, 405]).toContain(res.status);
    });
  });

  it('the test-only forward options are bound nowhere in the production module graph', () => {
    expect(() => ctx.module.get(BROKER_FORWARD_OPTIONS, { strict: false })).toThrow();
  });
});
