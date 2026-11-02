import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { AiKeyProjectionInterceptor, lastFourOfHint } from './ai-key-projection.interceptor';

const KEY = 'sk-test-0123456789abcdefghijkl';

function setup(opts: { described?: { hint: string; updatedAt: Date } | null; setFails?: Error } = {}) {
  let described: { hint: string; updatedAt: Date } | null = opts.described ?? null;
  const credentials = {
    describe: jest.fn(async () => described),
    setSecret: jest.fn(async () => {
      if (opts.setFails) throw opts.setFails;
      described = { hint: '••••ijkl', updatedAt: new Date('2026-06-01T00:00:00.000Z') };
    }),
    deleteSecret: jest.fn(async () => {
      described = null;
    }),
  };
  const prisma = { auditEvent: { create: jest.fn().mockResolvedValue({}) } };
  const interceptor = new AiKeyProjectionInterceptor(credentials as never, prisma as never);
  return { interceptor, credentials, prisma };
}

function run(
  interceptor: AiKeyProjectionInterceptor,
  req: { method: string; url: string; body?: unknown },
  result: unknown,
  handler = jest.fn(() => of(result)),
) {
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ ...req, requestUser: { id: 'admin-1' } }) }),
  };
  return { out: async () => lastValueFrom(interceptor.intercept(context as never, { handle: handler })), handler };
}

const doc = (ai: object = { enabled: true, provider: 'openai', model: 'm', maxCallsPerUserPerDay: 5 }) => ({
  ui: {},
  features: {},
  ai,
  version: 4,
});

describe('AiKeyProjectionInterceptor', () => {
  it('adds the masked projection to GET (key configured)', async () => {
    const { interceptor } = setup({ described: { hint: '••••1234', updatedAt: new Date('2026-01-01T00:00:00.000Z') } });
    const { out } = run(interceptor, { method: 'GET', url: '/api/system-settings' }, doc());

    const result = (await out()) as ReturnType<typeof doc>;

    expect(result.ai).toMatchObject({
      enabled: true,
      apiKeyConfigured: true,
      apiKeyLast4: '1234',
      apiKeyUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|authTag/);
  });

  it('reports not configured when the store holds no key', async () => {
    const { interceptor } = setup();
    const result = (await run(interceptor, { method: 'GET', url: '/api/system-settings?x=1' }, doc()).out()) as ReturnType<typeof doc>;
    expect(result.ai).toMatchObject({ apiKeyConfigured: false, apiKeyLast4: null, apiKeyUpdatedAt: null });
  });

  it('projects inside a { data } envelope too', async () => {
    const { interceptor } = setup();
    const result = (await run(interceptor, { method: 'GET', url: '/api/system-settings' }, { data: doc() }).out()) as {
      data: ReturnType<typeof doc>;
    };
    expect(result.data.ai).toMatchObject({ apiKeyConfigured: false });
  });

  it('ignores every other route and method', async () => {
    const { interceptor, credentials } = setup();
    for (const req of [
      { method: 'GET', url: '/api/user-settings' },
      { method: 'GET', url: '/api/system-settings/ai/verify' },
      { method: 'POST', url: '/api/system-settings' },
    ]) {
      const result = await run(interceptor, req, doc()).out();
      expect(result).toEqual(doc());
    }
    expect(credentials.describe).not.toHaveBeenCalled();
  });

  it('PATCH with a key removes it from the request before the handler, stores it, audits the mask only', async () => {
    const { interceptor, credentials, prisma } = setup();
    const body: { ai: Record<string, unknown> } = { ai: { model: 'm2', apiKey: KEY } };
    const { out, handler } = run(interceptor, { method: 'PATCH', url: '/api/system-settings', body }, doc());

    const result = (await out()) as ReturnType<typeof doc>;

    expect(handler).toHaveBeenCalled();
    expect(body.ai).toEqual({ model: 'm2' });
    expect(credentials.setSecret).toHaveBeenCalledWith('ai', 'openai', KEY, expect.objectContaining({ updatedByUserId: 'admin-1' }));
    expect(result.ai).toMatchObject({ apiKeyConfigured: true, apiKeyLast4: 'ijkl' });
    const audit = JSON.stringify(prisma.auditEvent.create.mock.calls);
    expect(audit).toContain('system_settings:ai_key');
    expect(audit).toContain('ijkl');
    expect(audit).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('PATCH with apiKey null clears the key', async () => {
    const { interceptor, credentials } = setup({ described: { hint: '••••1234', updatedAt: new Date() } });
    const result = (await run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { apiKey: null } } }, doc()).out()) as ReturnType<typeof doc>;
    expect(credentials.deleteSecret).toHaveBeenCalledWith('ai', 'openai');
    expect(result.ai).toMatchObject({ apiKeyConfigured: false });
  });

  it('PATCH without apiKey keeps the stored key untouched', async () => {
    const { interceptor, credentials, prisma } = setup({ described: { hint: '••••1234', updatedAt: new Date() } });
    await run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { model: 'm' }, ui: {} } }, doc()).out();
    await run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ui: {} } }, doc()).out();
    expect(credentials.setSecret).not.toHaveBeenCalled();
    expect(credentials.deleteSecret).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('PATCH with an explicit undefined key keeps the stored key', async () => {
    const { interceptor, credentials } = setup();
    await run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { apiKey: undefined } } }, doc()).out();
    expect(credentials.setSecret).not.toHaveBeenCalled();
    expect(credentials.deleteSecret).not.toHaveBeenCalled();
  });

  it.each([['short', 'sk-short'], ['long', 'k'.repeat(301)], ['number', 12345678901234567890 as unknown as string]])(
    'PATCH with a %s key is a 400 that never echoes it and never reaches the handler',
    async (_label, bad) => {
      const { interceptor, credentials } = setup();
      const { out, handler } = run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { apiKey: bad } } }, doc());

      const error = await out().then(
        () => null,
        (e) => e as BadRequestException,
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(String(bad).slice(0, 8) + 'x');
      expect(handler).not.toHaveBeenCalled();
      expect(credentials.setSecret).not.toHaveBeenCalled();
    },
  );

  it('does not change the key when the settings write fails (409, validation)', async () => {
    const { interceptor, credentials } = setup();
    const failing = jest.fn(() => {
      throw new Error('Settings version mismatch');
    });
    const { out } = run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { apiKey: KEY } } }, null, failing as never);
    await expect(out()).rejects.toThrow('version mismatch');
    expect(credentials.setSecret).not.toHaveBeenCalled();
  });

  it('answers 503 ENCRYPTION_UNAVAILABLE when the store cannot encrypt', async () => {
    const { interceptor } = setup({ setFails: new Error('SECRETS_ENCRYPTION_KEY missing') });
    const { out } = run(interceptor, { method: 'PATCH', url: '/api/system-settings', body: { ai: { apiKey: KEY } } }, doc());
    const error = await out().then(() => null, (e) => e as ServiceUnavailableException);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });
});

describe('lastFourOfHint', () => {
  it('reveals only the tail of the masked hint', () => {
    expect(lastFourOfHint('••••1234')).toBe('1234');
    expect(lastFourOfHint('••••')).toBeNull();
    expect(lastFourOfHint(null)).toBeNull();
  });
});
