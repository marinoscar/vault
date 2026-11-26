// =============================================================================
// Service keys for a server process (issue #241), through BOTH paths
// =============================================================================
//
// The release runs in process (`SERVICE_KEY_RELEASE_PORT`, a Buffer the host wipes) and over HTTP
// (`AgentServiceKeysController`, an `oat_` token). Both reach `AgentServiceKeysService` and the real
// `SecretsService` lookup over a mocked Prisma client and the test cipher; the values are canaries.
// =============================================================================

import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { responseHeadersOf } from '@marinoscar/platform-api/core';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { FakeSettings, InMemoryAudit, TestCrypto } from '../testing';
import { SecretsService } from '../secrets/secrets.service';
import { AgentCallPipeline } from './agent-pipeline';
import { InMemoryAgentRateLimiter } from './agent-rate-limiter';
import { AgentServiceKeysController } from './agent-service-keys.controller';
import { AgentServiceKeysService } from './agent-service-keys.service';

const USER = 'user-aaa';
const CANARY = 'sk-canary-Vt81!';
const OTHER_CANARY = 'sk-canary-other-Q2';

const oauth: AuthCredentialInfo = {
  kind: 'oauth', tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resourceId: 'agent',
  scopes: ['vault:service_keys_read'],
};

interface Row {
  id: string;
  name: string;
  createdById: string;
  agentAccess: 'fill' | 'none';
  values: Record<string, unknown>;
}

function world(rows: Row[], settings: Record<string, unknown> = { enabled: true }) {
  const crypto = new TestCrypto();
  const prisma: MockPrismaService = createMockPrismaService();
  // The lookup asks for the owner's Service Key rows, optionally opened only: answer like Postgres would.
  prisma.secret.findMany.mockImplementation((async (args: any) => {
    const where = args?.where ?? {};
    return rows
      .filter((r) => r.createdById === where.createdById)
      .filter((r) => (where.agentAccess ? r.agentAccess === where.agentAccess : true))
      .filter((r) => (where.NOT?.id ? r.id !== where.NOT.id : true))
      .map((r) => {
        const e = crypto.encrypt(JSON.stringify(r.values));
        return { id: r.id, name: r.name, versions: [{ encryptedData: e.ciphertext, iv: e.iv, authTag: e.authTag }] };
      });
  }) as never);
  const audit = new InMemoryAudit();
  return { prisma, crypto, audit, settings: new FakeSettings({ agentAccess: settings }) };
}

async function build(w: ReturnType<typeof world>) {
  const module = await Test.createTestingModule({
    providers: [
      SecretsService,
      AgentCallPipeline,
      AgentServiceKeysService,
      { provide: InMemoryAgentRateLimiter, useValue: new InMemoryAgentRateLimiter() },
      { provide: VAULT_PRISMA, useValue: w.prisma },
      { provide: VAULT_CRYPTO, useValue: w.crypto },
      { provide: VAULT_OBJECT_STORE, useValue: createMockStorageProvider() },
      { provide: VAULT_SETTINGS, useValue: w.settings },
      { provide: VAULT_AUDIT, useValue: w.audit },
    ],
  })
    .overrideProvider(AgentCallPipeline)
    .useFactory({ factory: () => new AgentCallPipeline(new InMemoryAgentRateLimiter(), w.settings, w.audit) })
    .compile();
  const service = module.get(AgentServiceKeysService);
  return { service, controller: new AgentServiceKeysController(service) };
}

const opened = (over: Partial<Row> = {}): Row => ({
  id: 'sk-1',
  name: 'Search key',
  createdById: USER,
  agentAccess: 'fill',
  values: { service: 'web_search', key_name: 'provider_a', key: CANARY },
  ...over,
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return {
      status: error.getStatus(),
      code: typeof body === 'object' && body !== null ? (body as { code?: string }).code : undefined,
      body: JSON.stringify(body),
      headers: { ...responseHeadersOf(error, {}) },
    };
  }
  throw new Error('expected a refusal');
}

type Read = (service: string, name: string) => Promise<string>;
const drivers: Array<[string, (s: Awaited<ReturnType<typeof build>>) => Read]> = [
  [
    'in process (SERVICE_KEY_RELEASE_PORT)',
    ({ service }) => async (svc, name) => {
      const { value } = await service.releaseServiceKey({ userId: USER, clientLabel: 'Host A', service: svc, name });
      expect(Buffer.isBuffer(value)).toBe(true);
      const text = value.toString('utf8');
      value.fill(0);
      return text;
    },
  ],
  [
    'HTTP (controller, oat_ token)',
    ({ controller }) => async (svc, name) => (await controller.read(svc, name, { id: USER } as never, oauth)).data.value,
  ],
];

describe.each(drivers)('service key release, %s', (_label, drive) => {
  it('releases the one opened key by normalized service and name, and audits it without the value', async () => {
    const w = world([opened(), opened({ id: 'sk-2', name: 'Other', values: { service: 'web_search', key_name: 'provider_b', key: OTHER_CANARY } })]);
    const read = drive(await build(w));
    await expect(read('Web_Search', ' PROVIDER_A ')).resolves.toBe(CANARY);
    expect(w.audit.events).toHaveLength(1);
    const [row] = w.audit.events;
    expect(row).toMatchObject({ actorUserId: USER, action: 'agent.service_key.read', targetType: 'secret', targetId: 'sk-1' });
    expect(row!.meta).toMatchObject({ result: 'ok', service: 'web_search', keyName: 'provider_a', purpose: 'service_call', origin: null });
    expect(JSON.stringify(w.audit.events)).not.toContain(CANARY);
    expect(JSON.stringify(w.audit.events)).not.toContain(OTHER_CANARY);
  });

  it('answers one identical 404 for a closed, foreign or missing key, and audits the denial', async () => {
    const w = world([
      opened({ id: 'closed', agentAccess: 'none', values: { service: 'web_search', key_name: 'closed_one', key: CANARY } }),
      opened({ id: 'foreign', createdById: 'user-bbb', values: { service: 'web_search', key_name: 'foreign_one', key: CANARY } }),
    ]);
    const read = drive(await build(w));
    const closed = await refusal(read('web_search', 'closed_one'));
    const foreign = await refusal(read('web_search', 'foreign_one'));
    const missing = await refusal(read('web_search', 'nothing'));
    expect([closed.status, foreign.status, missing.status]).toEqual([404, 404, 404]);
    expect(new Set([closed.body, foreign.body, missing.body]).size).toBe(1);
    expect(w.audit.events.map((e) => (e.meta as { result: string }).result)).toEqual(['denied:not_found', 'denied:not_found', 'denied:not_found']);
    expect(JSON.stringify(w.audit.events)).not.toContain(CANARY);
  });

  it('refuses two opened keys with the same service and name (409 SERVICE_KEY_AMBIGUOUS), releasing neither', async () => {
    const w = world([opened(), opened({ id: 'sk-dup', name: 'Dup', values: { service: 'web_search', key_name: 'provider_a', key: OTHER_CANARY } })]);
    const read = drive(await build(w));
    const res = await refusal(read('web_search', 'provider_a'));
    expect([res.status, res.code]).toEqual([409, 'SERVICE_KEY_AMBIGUOUS']);
    expect(res.body).not.toContain(CANARY);
    expect(res.body).not.toContain(OTHER_CANARY);
    expect((w.audit.events[0]!.meta as { result: string }).result).toBe('denied:ambiguous');
  });

  it('is a 400 for an invalid id, and never records the raw id', async () => {
    const w = world([opened()]);
    const read = drive(await build(w));
    const res = await refusal(read('web search!', 'provider_a'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(w.audit.events)).not.toContain('web search!');
    expect(w.prisma.secret.findMany).not.toHaveBeenCalled();
  });

  it('is refused while agentAccess.enabled is off (403 AGENT_ACCESS_DISABLED), before any lookup', async () => {
    const w = world([opened()], { enabled: false });
    const read = drive(await build(w));
    const res = await refusal(read('web_search', 'provider_a'));
    expect([res.status, res.code]).toEqual([403, 'AGENT_ACCESS_DISABLED']);
    expect(w.prisma.secret.findMany).not.toHaveBeenCalled();
  });

  it('allows 120 releases a minute per owner and service, then 429 with Retry-After', async () => {
    const w = world([opened(), opened({ id: 'sk-3', values: { service: 'maps', key_name: 'provider_a', key: OTHER_CANARY } })]);
    const read = drive(await build(w));
    for (let i = 0; i < 120; i += 1) await read('web_search', 'provider_a');
    const res = await refusal(read('web_search', 'provider_a'));
    expect([res.status, res.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
    // Another service of the same owner has its own count.
    await expect(read('maps', 'provider_a')).resolves.toBe(OTHER_CANARY);
  });
});

describe('service key release callers', () => {
  it('refuses a browser session (403 AGENT_CREDENTIAL_REQUIRED) and an unlabelled in-process call', async () => {
    const { service, controller } = await build(world([opened()]));
    const session = await refusal(controller.read('web_search', 'provider_a', { id: USER } as never, null));
    expect([session.status, session.code]).toEqual([403, 'AGENT_CREDENTIAL_REQUIRED']);
    const unlabelled = await refusal(service.releaseServiceKey({ userId: USER, clientLabel: ' ', service: 'web_search', name: 'provider_a' }));
    expect([unlabelled.status, unlabelled.code]).toEqual([403, 'AGENT_CREDENTIAL_REQUIRED']);
  });

  it('records an embedded caller by its label', async () => {
    const w = world([opened()]);
    const { service } = await build(w);
    const { value } = await service.releaseServiceKey({ userId: USER, clientLabel: 'Host A', service: 'web_search', name: 'provider_a' });
    value.fill(0);
    expect(w.audit.events[0]!.meta).toMatchObject({ credential: 'embedded', clientLabel: 'Host A' });
  });
});
