import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { responseHeadersOf } from '@marinoscar/platform-api/core';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';

import { FakeSettings, InMemoryAudit, RecordingNotify } from '../testing';
import { AgentNotifier } from './agent-notifier.service';
import { SecretsService } from '../secrets/secrets.service';
import { AgentCredentialsService, type AgentCaller } from './agent-credentials.service';
import { InMemoryAgentRateLimiter } from './agent-rate-limiter';

const USER = 'user-aaa';
const ID = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://shop.example.test';
const CANARY_PASSWORD = 'canary-Pw-9f3k2m!x';
const CANARY_USER = 'person-a@example.test';

const oauth: AuthCredentialInfo = {
  kind: 'oauth', tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resourceId: 'agent', scopes: ['vault:items_fill'],
};
const pat: AuthCredentialInfo = { kind: 'pat', tokenId: 'pat-1' };
const caller = (credential: AuthCredentialInfo | null = oauth): AgentCaller => ({ userId: USER, credential });

const secretRow = (over: Record<string, unknown> = {}) => ({
  id: ID, name: 'Shop', createdById: USER, agentAccess: 'fill', origins: [ORIGIN],
  type: { name: 'Credential', isSystem: true }, ...over,
});

function build(settings: Record<string, unknown> = { enabled: true }) {
  const secrets = {
    findAgentAccessibleSecret: jest.fn().mockResolvedValue(secretRow()),
    assertAgentAccessible: jest.fn((s: unknown) => { if (!s) throw new NotFoundException('Secret not found'); }),
    readCurrentValues: jest.fn().mockResolvedValue({ username: CANARY_USER, password: CANARY_PASSWORD, totp: 'x' }),
    generateTotpForSecret: jest.fn().mockResolvedValue({ code: '123456', expiresAt: '2030-01-01T00:00:30.000Z', period: 30 }),
    findCredentialsByOrigin: jest.fn().mockResolvedValue([
      { id: ID, name: 'Shop', username: null, origins: [ORIGIN], matchKind: 'exact' },
    ]),
    describeAgentCredentials: jest.fn().mockResolvedValue(new Map([[ID, { username: CANARY_USER, hasTotp: true, updatedAt: '2030-01-01T00:00:00.000Z' }]])),
    createAgentCredential: jest.fn().mockResolvedValue({ id: ID, name: 'Shop', origins: [ORIGIN] }),
    rotateCredentialPassword: jest.fn().mockResolvedValue({ version: 2 }),
  };
  const audit = new InMemoryAudit();
  const limiter = new InMemoryAgentRateLimiter();
  const notify = new RecordingNotify();
  // The new-app check reads the trail: it sees what the in-memory audit holds, like the real query.
  const prisma = {
    auditEvent: {
      findFirst: jest.fn(async (args: { where: { action: string; AND: Array<{ meta: { path: string[]; equals: string } }> } }) => {
        const [result, actor] = args.where.AND.map((c) => c.meta);
        return audit.events.find(
          (e) => e.action === args.where.action && (e.meta as Record<string, unknown>)[result.path[0]] === result.equals &&
            (e.meta as Record<string, unknown>)[actor.path[0]] === actor.equals,
        ) ?? null;
      }),
    },
    oAuthClient: { findUnique: jest.fn().mockResolvedValue({ name: 'Agent App A' }) },
  };
  const notifier = new AgentNotifier(prisma as never, notify as never);
  const service = new AgentCredentialsService(
    secrets as unknown as SecretsService, limiter, new FakeSettings({ agentAccess: settings }), audit, notifier,
  );
  return { service, secrets, audit, limiter, notify, prisma };
}

const fillBody = (over: Record<string, unknown> = {}) =>
  ({ field: 'password', origin: ORIGIN, purpose: 'login', ...over }) as never;

async function status(promise: Promise<unknown>): Promise<{ status: number; code?: string; headers?: Record<string, string> }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string };
      return { status: error.getStatus(), code: body.code, headers: { ...responseHeadersOf(error, {}) } };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('AgentCredentialsService', () => {
  describe('lookup', () => {
    it('returns matches with the decrypted username, hasTotp and updatedAt', async () => {
      const { service } = build();
      await expect(service.lookup(caller(), ORIGIN)).resolves.toEqual([
        { id: ID, name: 'Shop', username: CANARY_USER, origins: [ORIGIN], matchKind: 'exact', hasTotp: true, updatedAt: '2030-01-01T00:00:00.000Z' },
      ]);
    });

    it('answers 400 for an invalid origin and audits denied:invalid', async () => {
      const { service, audit } = build();
      expect((await status(service.lookup(caller(), 'not a url'))).status).toBe(400);
      expect(audit.events[0]!.meta).toMatchObject({ result: 'denied:invalid', origin: null });
    });

    it('works for a personal access token too', async () => {
      const { service, audit } = build();
      await service.lookup(caller(pat), ORIGIN);
      expect(audit.events[0]!.meta).toMatchObject({ credential: 'pat', tokenId: 'pat-1', result: 'ok' });
    });
  });

  describe('fill', () => {
    it('returns exactly the one requested field', async () => {
      const { service } = build();
      await expect(service.fill(caller(), ID, fillBody())).resolves.toEqual({ value: CANARY_PASSWORD });
      await expect(service.fill(caller(), ID, fillBody({ field: 'username' }))).resolves.toEqual({ value: CANARY_USER });
    });

    it('normalizes the asked origin before the exact comparison', async () => {
      const { service } = build();
      await expect(service.fill(caller(), ID, fillBody({ origin: 'HTTPS://Shop.Example.Test/login?x=1' }))).resolves.toEqual({ value: CANARY_PASSWORD });
    });

    it('answers 403 ORIGIN_MISMATCH for another origin, a subdomain and the same site (never "site" matches)', async () => {
      const { service, secrets } = build();
      for (const origin of ['https://evil.example.test', 'https://www.shop.example.test', 'https://shop.example.test:8443']) {
        expect(await status(service.fill(caller(), ID, fillBody({ origin })))).toMatchObject({ status: 403, code: 'ORIGIN_MISMATCH' });
      }
      expect(secrets.readCurrentValues).not.toHaveBeenCalled();
    });

    it('answers 404 for a secret that is missing, foreign, not opened or not a Credential (same body)', async () => {
      const { service, secrets } = build();
      secrets.findAgentAccessibleSecret.mockResolvedValue(null);
      expect(await status(service.fill(caller(), ID, fillBody()))).toMatchObject({ status: 404 });
      expect(secrets.readCurrentValues).not.toHaveBeenCalled();
    });

    it('answers 400 for an unparseable origin and never reaches the values', async () => {
      const { service, secrets } = build();
      expect((await status(service.fill(caller(), ID, fillBody({ origin: '::::' })))).status).toBe(400);
      expect(secrets.readCurrentValues).not.toHaveBeenCalled();
    });
  });

  describe('totp', () => {
    it('returns code and expiresAt after the origin check', async () => {
      const { service } = build();
      await expect(service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' })).resolves.toEqual({
        code: '123456', expiresAt: '2030-01-01T00:00:30.000Z',
      });
    });

    it('answers 403 on a mismatched origin and 404 when there is no seed', async () => {
      const { service, secrets } = build();
      expect(await status(service.totp(caller(), ID, { origin: 'https://x.example.test', purpose: 'mfa' }))).toMatchObject({ status: 403, code: 'ORIGIN_MISMATCH' });
      secrets.generateTotpForSecret.mockRejectedValue(new NotFoundException('Secret not found'));
      expect((await status(service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' }))).status).toBe(404);
    });
  });

  describe('create', () => {
    const body = (over: Record<string, unknown> = {}) =>
      ({ name: 'Shop', username: CANARY_USER, origin: 'shop.example.test', purpose: 'signup', ...over }) as never;

    it('stores a supplied password and does not return it', async () => {
      const { service, secrets } = build();
      const result = await service.create(caller(), body({ password: CANARY_PASSWORD }));
      expect(result).toEqual({ id: ID, name: 'Shop', username: CANARY_USER, origins: [ORIGIN] });
      expect(JSON.stringify(result)).not.toContain(CANARY_PASSWORD);
      expect(secrets.createAgentCredential).toHaveBeenCalledWith(USER, {
        name: 'Shop',
        values: { username: CANARY_USER, password: CANARY_PASSWORD, url: ORIGIN },
      });
    });

    it('generates a password, stores it and returns it once', async () => {
      const { service, secrets } = build();
      const result = await service.create(caller(), body({ generate: { length: 30, symbols: true }, additionalUrls: ['https://m.shop.example.test/x'] }));
      expect(result.generatedPassword).toHaveLength(30);
      const stored = secrets.createAgentCredential.mock.calls[0]![1].values;
      expect(stored.password).toBe(result.generatedPassword);
      expect(stored.additional_urls).toBe('https://m.shop.example.test');
    });

    it('answers 400 for an invalid origin or additional url, 409 for a name clash', async () => {
      const { service, secrets } = build();
      expect((await status(service.create(caller(), body({ origin: '::', password: 'x' })))).status).toBe(400);
      expect((await status(service.create(caller(), body({ password: 'x', additionalUrls: ['ftp://a.test'] })))).status).toBe(400);
      secrets.createAgentCredential.mockRejectedValue(new HttpException('exists', 409));
      expect((await status(service.create(caller(), body({ password: 'x' })))).status).toBe(409);
    });

    it('audits the new secret id and that it was generated, not the password', async () => {
      const { service, audit } = build();
      await service.create(caller(), body({ generate: {} }));
      expect(audit.events[0]).toMatchObject({ action: 'agent.credential.create', targetType: 'secret', targetId: ID });
      expect(audit.events[0]!.meta).toMatchObject({ result: 'ok', generated: true, purpose: 'signup' });
    });
  });

  describe('rotate', () => {
    it('adds a version and returns a generated password once', async () => {
      const { service, secrets } = build();
      const result = await service.rotate(caller(), ID, { origin: ORIGIN, generate: { length: 16, symbols: false }, purpose: 'password_change' } as never);
      expect(result).toMatchObject({ id: ID, version: 2 });
      expect(result.generatedPassword).toHaveLength(16);
      expect(secrets.rotateCredentialPassword).toHaveBeenCalledWith(ID, USER, result.generatedPassword);
    });

    it('with a supplied password does not echo it', async () => {
      const { service } = build();
      const result = await service.rotate(caller(), ID, { origin: ORIGIN, password: CANARY_PASSWORD, purpose: 'password_change' } as never);
      expect(result).toEqual({ id: ID, version: 2 });
    });

    it('answers 404 when not agent-accessible and 403 on an origin mismatch', async () => {
      const { service, secrets } = build();
      const b = { origin: ORIGIN, generate: {}, purpose: 'password_change' } as never;
      expect(await status(service.rotate(caller(), ID, { ...(b as object), origin: 'https://o.example.test' } as never))).toMatchObject({ status: 403, code: 'ORIGIN_MISMATCH' });
      secrets.findAgentAccessibleSecret.mockResolvedValue(null);
      expect((await status(service.rotate(caller(), ID, b))).status).toBe(404);
      expect(secrets.rotateCredentialPassword).not.toHaveBeenCalled();
    });
  });

  describe('kill switch, credential kind and whoami', () => {
    it('answers 403 AGENT_ACCESS_DISABLED on every route while the switch is off (default)', async () => {
      for (const settings of [{}, { enabled: false }]) {
        const { service, secrets } = build(settings);
        const results = await Promise.all([
          status(service.lookup(caller(), ORIGIN)),
          status(service.fill(caller(), ID, fillBody())),
          status(service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' })),
          status(service.create(caller(), { name: 'a', username: 'b', origin: ORIGIN, password: 'c', purpose: 'login' } as never)),
          status(service.rotate(caller(), ID, { origin: ORIGIN, generate: {}, purpose: 'login' } as never)),
          status(service.assertEnabled()),
        ]);
        for (const r of results) expect(r).toMatchObject({ status: 403, code: 'AGENT_ACCESS_DISABLED' });
        expect(secrets.findAgentAccessibleSecret).not.toHaveBeenCalled();
        expect(secrets.createAgentCredential).not.toHaveBeenCalled();
      }
    });

    it('assertEnabled passes when on', async () => {
      await expect(build().service.assertEnabled()).resolves.toBeUndefined();
    });

    it('refuses a browser session (jwt), a node and no credential with 403, before any work', async () => {
      const { service, secrets } = build();
      for (const credential of [{ kind: 'jwt' } as AuthCredentialInfo, { kind: 'node' } as AuthCredentialInfo, null]) {
        const err = await status(service.fill(caller(credential), ID, fillBody()));
        expect(err).toMatchObject({ status: 403, code: 'AGENT_CREDENTIAL_REQUIRED' });
      }
      expect(secrets.findAgentAccessibleSecret).not.toHaveBeenCalled();
      expect(secrets.readCurrentValues).not.toHaveBeenCalled();
    });

    it('treats a refusal for the credential kind as the same ForbiddenException type', async () => {
      const { service } = build();
      await expect(service.lookup(caller({ kind: 'jwt' }), ORIGIN)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('rate limits', () => {
    it('answers 429 RATE_LIMITED with Retry-After once the bucket is spent, then resets', async () => {
      const { service, limiter } = build({ enabled: true, fillPerMinute: 2 });
      let now = 10_000;
      limiter.now = () => now;
      await service.fill(caller(), ID, fillBody());
      await service.fill(caller(), ID, fillBody());
      const limited = await status(service.fill(caller(), ID, fillBody()));
      expect(limited).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      expect(Number(limited.headers!['Retry-After'])).toBeGreaterThanOrEqual(1);
      now += 61_000;
      await expect(service.fill(caller(), ID, fillBody())).resolves.toBeDefined();
    });

    it('counts per grant and per bucket: another grant, and lookup, are unaffected', async () => {
      const { service } = build({ enabled: true, fillPerMinute: 1, totpPerMinute: 1, lookupPerMinute: 5 });
      await service.fill(caller(oauth), ID, fillBody());
      expect((await status(service.fill(caller(oauth), ID, fillBody()))).status).toBe(429);
      await expect(service.fill(caller({ ...oauth, grantId: 'grant-2' } as AuthCredentialInfo), ID, fillBody())).resolves.toBeDefined();
      await expect(service.fill(caller(pat), ID, fillBody())).resolves.toBeDefined();
      await expect(service.lookup(caller(oauth), ORIGIN)).resolves.toBeDefined();
      await expect(service.totp(caller(oauth), ID, { origin: ORIGIN, purpose: 'mfa' })).resolves.toBeDefined();
    });

    it('write calls share one bucket (create and rotate)', async () => {
      const { service } = build({ enabled: true, writePerMinute: 1 });
      await service.create(caller(), { name: 'a', username: 'b', origin: ORIGIN, password: 'c', purpose: 'signup' } as never);
      expect((await status(service.rotate(caller(), ID, { origin: ORIGIN, generate: {}, purpose: 'login' } as never))).status).toBe(429);
    });

    it('a rate-limited call is audited denied:rate_limited', async () => {
      const { service, audit } = build({ enabled: true, lookupPerMinute: 1 });
      await service.lookup(caller(), ORIGIN);
      await status(service.lookup(caller(), ORIGIN));
      expect(audit.events.map((e) => (e.meta as { result: string }).result)).toEqual(['ok', 'denied:rate_limited']);
    });
  });

  describe('audit', () => {
    it('writes one row per call with actor, kind, client, secret, field, origin, purpose and result', async () => {
      const { service, audit } = build();
      await service.fill(caller(), ID, fillBody({ field: 'username' }));
      expect(audit.events).toEqual([
        {
          actorUserId: USER, action: 'agent.credential.fill', targetType: 'secret', targetId: ID,
          meta: { result: 'ok', credential: 'oauth', clientId: 'client-1', grantId: 'grant-1', secretId: ID, field: 'username', origin: ORIGIN, purpose: 'login' },
        },
      ]);
    });

    it('records the secret on an origin mismatch and the reason', async () => {
      const { service, audit } = build();
      await status(service.fill(caller(), ID, fillBody({ origin: 'https://evil.example.test' })));
      expect(audit.events[0]!.meta).toMatchObject({ result: 'denied:origin_mismatch', secretId: ID, origin: 'https://evil.example.test' });
    });

    it('audits a disabled call and a 404 with the actor, with no secret id for a lookup', async () => {
      const off = build({ enabled: false });
      await status(off.service.lookup(caller(), ORIGIN));
      expect(off.audit.events[0]).toMatchObject({ action: 'agent.credential.lookup', targetType: 'user', targetId: USER });
      expect(off.audit.events[0]!.meta).toMatchObject({ result: 'denied:disabled' });
      const on = build();
      on.secrets.findAgentAccessibleSecret.mockResolvedValue(null);
      await status(on.service.fill(caller(), ID, fillBody()));
      expect(on.audit.events[0]!.meta).toMatchObject({ result: 'denied:not_found', secretId: ID });
    });

    it('never holds a value, a code, a password or the username (canary over every route)', async () => {
      const { service, audit } = build();
      await service.lookup(caller(), ORIGIN);
      await service.fill(caller(), ID, fillBody());
      await service.fill(caller(), ID, fillBody({ field: 'username' }));
      await service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' });
      await service.create(caller(), { name: 'n', username: CANARY_USER, origin: ORIGIN, password: CANARY_PASSWORD, purpose: 'signup' } as never);
      const generated = await service.create(caller(), { name: 'n2', username: 'u2', origin: ORIGIN, generate: {}, purpose: 'signup' } as never);
      await service.rotate(caller(), ID, { origin: ORIGIN, password: CANARY_PASSWORD, purpose: 'password_change' } as never);
      await status(service.fill(caller(), ID, fillBody({ origin: 'https://evil.example.test' })));
      const dump = JSON.stringify(audit.events);
      for (const secret of [CANARY_PASSWORD, CANARY_USER, '123456', generated.generatedPassword!]) {
        expect(dump).not.toContain(secret);
      }
      expect(audit.events).toHaveLength(8);
    });

    it('fails a successful call closed when the audit trail cannot be written, and still raises a denial when it cannot', async () => {
      const ok = build();
      ok.audit.record = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(ok.service.fill(caller(), ID, fillBody())).rejects.toThrow('db down');
      const denied = build();
      denied.audit.record = jest.fn().mockRejectedValue(new Error('db down'));
      expect(await status(denied.service.fill(caller(), ID, fillBody({ origin: 'https://evil.example.test' })))).toMatchObject({ status: 403, code: 'ORIGIN_MISMATCH' });
    });
  });
});

describe('AgentCredentialsService notifications (E14.7)', () => {
  const events = (notify: RecordingNotify) => notify.sent.map((s) => s.event);

  it('the first successful fill by an app raises new_app once, and every fill raises a counted credential_used', async () => {
    const { service, notify } = build();
    await service.fill(caller(), ID, fillBody());
    expect(events(notify)).toEqual(['vault.agent_new_app', 'vault.agent_credential_used']);
    await service.fill(caller(), ID, fillBody({ field: 'username' }));
    expect(events(notify)).toEqual(['vault.agent_new_app', 'vault.agent_credential_used', 'vault.agent_credential_used']);
    const used = notify.sent[1]!;
    expect(used.target).toBe(USER);
    expect(used.options).toMatchObject({ windowMs: 3_600_000, match: { secretId: ID, app: 'client-1' } });
  });

  it('a different app gets its own new_app; a PAT is its own app named "Personal access token"', async () => {
    const { service, notify } = build();
    await service.fill(caller(), ID, fillBody());
    await service.fill(caller({ ...oauth, clientId: 'client-2', grantId: 'grant-2' } as AuthCredentialInfo), ID, fillBody());
    await service.fill(caller(pat), ID, fillBody());
    expect(events(notify).filter((e) => e === 'vault.agent_new_app')).toHaveLength(3);
    expect((notify.sent.at(-2)!.data as { clientName: string }).clientName).toBe('Personal access token');
  });

  it('a denied fill (or a lookup) notifies nobody and does not make the app "seen"', async () => {
    const { service, notify } = build();
    await status(service.fill(caller(), ID, fillBody({ origin: 'https://evil.example.test' })));
    await service.lookup(caller(), ORIGIN);
    expect(notify.sent).toEqual([]);
    await service.fill(caller(), ID, fillBody());
    expect(events(notify)[0]).toBe('vault.agent_new_app');
  });

  it('totp raises credential_used only', async () => {
    const { service, notify } = build();
    await service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' } as never);
    expect(events(notify)).toEqual(['vault.agent_credential_used']);
    expect((notify.sent[0]!.data as { action: string }).action).toBe('totp');
  });

  it('create and rotate raise credential_changed with the name and origin', async () => {
    const { service, notify } = build();
    await service.create(caller(), { name: 'Shop', username: CANARY_USER, origin: ORIGIN, password: CANARY_PASSWORD, purpose: 'signup' } as never);
    await service.rotate(caller(), ID, { origin: ORIGIN, generate: { length: 24, symbols: true }, purpose: 'password_change' } as never);
    expect(notify.sent.map((s) => [s.event, (s.data as { change: string }).change])).toEqual([
      ['vault.agent_credential_changed', 'created'],
      ['vault.agent_credential_changed', 'rotated'],
    ]);
    expect(notify.sent[0]!.data).toMatchObject({ secretId: ID, secretName: 'Shop', origin: ORIGIN, clientName: 'Agent App A' });
  });

  it('no notification payload carries a value, a code or a generated password', async () => {
    const { service, notify } = build();
    await service.fill(caller(), ID, fillBody());
    await service.totp(caller(), ID, { origin: ORIGIN, purpose: 'mfa' } as never);
    await service.create(caller(), { name: 'Shop', username: CANARY_USER, origin: ORIGIN, generate: { length: 24, symbols: true }, purpose: 'signup' } as never);
    const blob = JSON.stringify(notify.sent);
    expect(blob).not.toContain(CANARY_PASSWORD);
    expect(blob).not.toContain(CANARY_USER);
    expect(blob).not.toContain('123456');
  });

  it('notifies after the work committed and the audit row was written, and a failing notifier never fails the call', async () => {
    const { service, audit, notify, secrets } = build();
    const order: string[] = [];
    secrets.readCurrentValues.mockImplementation(async () => { order.push('work'); return { password: CANARY_PASSWORD }; });
    const record = audit.record.bind(audit);
    audit.record = async (e) => { order.push('audit'); return record(e); };
    notify.notifyCounted = async () => { order.push('notify'); throw new Error('mail down'); };
    notify.notify = async () => { order.push('notify'); throw new Error('mail down'); };
    await expect(service.fill(caller(), ID, fillBody())).resolves.toEqual({ value: CANARY_PASSWORD });
    expect(order).toEqual(['work', 'audit', 'notify', 'notify']);
  });
});
