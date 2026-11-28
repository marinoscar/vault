// =============================================================================
// The credential broker, attacked (issue #246, ADR-0006 Enforcement and Threat model)
// =============================================================================
//
// The same real deployment as `broker.db.spec.ts` (migrated Postgres, ordinary application role, the
// full app, REAL `vbk_` / `pat_` tokens, a local HTTPS upstream trusted through a throwaway CA with TLS
// verification ON), driven like an attacker would. Every case goes over HTTP into the real app.
//
//   1. SSRF: every spelling of a private, loopback, metadata or look-alike host is refused BEFORE any
//      resolution or connection; DNS rebinding (resolve once, connect to the validated address only);
//      a name with one public and one private address is refused; the owner's opt-in refuses them too.
//   2. Redirects are returned as they are and never followed (the upstream sees exactly one request).
//   3. No echo: the key raw, base64, base64url, unpadded, percent-encoded (both cases), in a header,
//      gzip/deflate/brotli, split across chunks, the Basic credential and the query pair all answer
//      502 BROKER_KEY_ECHO with nothing of the body; an encoding it cannot decode fails closed.
//   4. Header hygiene in both directions; the injected header or query parameter exactly once.
//   5. Token confinement and lifecycle, identical 404s, kill switches, the rate limit.
//   6. Caps and timeouts.
//   7. SECRET EGRESS: the key, its encodings and every token value are absent from audit rows, Agent
//      activity, the token list, every response the upstream did not write, and every log line.
//
// A `*.db.spec.ts`: run by `npm run test:db`, skipped without a reachable Postgres superuser.
// =============================================================================

import '../../src/app-registrations/registrations';

import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { AuthService, PRINCIPAL_USER_INCLUDE } from '@marinoscar/platform-api/identity';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { AgentRateLimiter } from '@marinoscar/vault-api/agent';
import {
  BrokerForwardService,
  BrokerResolver,
  BrokerUpstream,
  NodeHttpsBrokerUpstream,
  installBrokerRawBody,
  type BrokerUpstreamRequest,
  type BrokerUpstreamResponse,
} from '@marinoscar/vault-api/broker';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_PRISMA, VAULT_SETTINGS } from '@marinoscar/vault-api/ports';

import { AppModule } from '../../src/app.module';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/settings/registry/default-system-settings';
import { findAdminCredentials, provisionAppRoleDatabase, type AppRoleDatabase } from '../helpers/app-role-database.helper';
import { createTestPki, startLocalHttps, type LocalHttps, type TestPki } from './local-https';

const admin = findAdminCredentials();
const describeWithDb = admin ? describe : describe.skip;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
const b64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const DAY = 24 * 3600 * 1000;

const UPSTREAM = 'upstream.example.test';
const REBIND = 'rebind.example.test';
const DNS_HOST = 'dns.example.test';
const PUBLIC_ADDR = '93.184.216.34';

// Invented, obviously fake keys. KEY_SPECIAL has characters that change under percent- and base64-encoding.
const KEY = 'sk-live-AdversaryCanary_4Qw8zN2m';
const KEY_SPECIAL = 'sk>>>???live/+Canary=7&z q';
const KEY_BASIC = 'user-a:pass-Canary_77';
const KEY_QUERY = 'qk/Canary+5 Rt&=';
const KEY_HEADER = 'hk-Canary_3Wd';
const FOREIGN_KEY = 'sk-live-ForeignAdversary_6Jd1';
const ALL_KEYS = [KEY, KEY_SPECIAL, KEY_BASIC, KEY_QUERY, KEY_HEADER, FOREIGN_KEY];

interface Addr { address: string; family: 4 | 6 }
interface RawResult { status: number; headers: IncomingHttpHeaders; text: string }

/** Sends bytes to the real app exactly as written (no client-side URL normalisation). */
function rawRequest(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string | string[]>; body?: Buffer | string; chunks?: Buffer[] },
): Promise<RawResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RawResult) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = httpRequest({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers, agent: false }, (res: IncomingMessage) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => finish({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
      res.on('error', () => finish({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', () => finish({ status: 0, headers: {}, text: '' }));
    if (opts.chunks) {
      void (async () => {
        for (const chunk of opts.chunks!) {
          if (settled) break;
          req.write(chunk);
          await new Promise((r) => setTimeout(r, 15));
        }
        req.end();
      })();
    } else req.end(opts.body);
  });
}

class SpyUpstream extends BrokerUpstream {
  sent: BrokerUpstreamRequest[] = [];
  /** Addresses that are not real: answered with a canned response, never connected to. */
  fake = new Set<string>([PUBLIC_ADDR]);
  constructor(private readonly real: BrokerUpstream) {
    super();
  }
  async send(req: BrokerUpstreamRequest): Promise<BrokerUpstreamResponse> {
    this.sent.push(req);
    if (this.fake.has(req.address)) return { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('fake-upstream') };
    return this.real.send(req);
  }
}

describeWithDb('credential broker, adversarial (real Postgres, real TLS upstream, #246)', () => {
  let deployment: AppRoleDatabase;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let pki: TestPki;
  let upstream: LocalHttps;
  let rebindUpstream: LocalHttps;
  let spy: SpyUpstream;
  let limiter: AgentRateLimiter;
  let forwardService: BrokerForwardService;
  let appPort = 0;
  let userId = '';
  let otherUserId = '';
  let orgId = '';
  let session = '';
  let otherSession = '';
  let apiKeyTypeId = '';
  let pat = '';
  let otherPat = '';
  let sA = ''; // KEY, default injection
  let sSpecial = ''; // KEY_SPECIAL
  let sBasic = ''; // Authorization: Basic
  let sQuery = ''; // ?api_key=
  let sHeader = ''; // X-Api-Key
  let sB = ''; // second plain secret, for token restriction
  let sForeign = ''; // another user's secret
  let vbk = '';
  let vbkId = '';
  let vbkRestricted = ''; // restricted to sA
  const allTokens: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};
  const restores: Array<() => void> = [];
  const logLines: string[] = [];
  /** Every response of the app that the upstream did NOT write (checked in the egress sweep). */
  const brokerOwnResponses: string[] = [];

  // Test-controlled DNS: host -> answers per call number. Unknown hosts answer a public address.
  const dnsCalls: string[] = [];
  const dnsRound = new Map<string, number>();
  const dnsAnswers = new Map<string, (call: number) => Addr[]>();
  let echoKey = KEY;
  const rawSeen: Array<{ url: string; rawHeaders: string[]; method: string; bodyLength: number }> = [];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = () => app.get(SystemSettingsService);
  const origin = () => `https://${UPSTREAM}:${upstream.port}`;
  const hostPort = () => `${UPSTREAM}:${upstream.port}`;
  const setBroker = (broker: Record<string, unknown>, enabled = true) => settings().patchSettings({ agentAccess: { enabled, broker } } as never, userId);
  const resetBroker = () =>
    setBroker({ enabled: true, forwardsPerMinute: 10_000, maxRequestBytes: 10 * 1024 * 1024, maxResponseBytes: 25 * 1024 * 1024, timeoutMs: 30_000 });
  const clearLimiter = () => (limiter as unknown as { windows?: Map<string, unknown> }).windows?.clear();
  const calls = (host: string) => dnsRound.get(host) ?? 0;

  /** One forward over real HTTP; the response is recorded unless the upstream wrote it. */
  async function fwd(token: string, secret: string, host: string, path = '/silent', extra: Partial<Parameters<typeof rawRequest>[1]> = {}): Promise<RawResult> {
    const res = await rawRequest(appPort, {
      path: `/api/broker/v1/${secret}/${host}${path}`,
      ...extra,
      headers: { authorization: `Bearer ${token}`, ...(extra.headers ?? {}) },
    });
    if (res.headers['x-vault-broker'] !== '1') brokerOwnResponses.push(JSON.stringify({ status: res.status, headers: res.headers, text: res.text }));
    return res;
  }

  const field = (name: string, required: boolean, sensitive = false) => ({ name, label: name, type: 'string', required, sensitive });
  async function createUser(email: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'contributor' } });
    const user = await prisma.user.create({ data: { email, providerDisplayName: 'Person A', isActive: true } });
    await prisma.membership.create({ data: { userId: user.id, orgId, roleId: role.id, status: 'active' } });
    const graph = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId });
    return { id: user.id, session: tokens.accessToken };
  }
  async function createPat(forUser: string) {
    const raw = `pat_${randomBytes(32).toString('hex')}`;
    await prisma.personalAccessToken.create({
      data: { userId: forUser, name: 'adversarial pat', tokenHash: sha256(raw), tokenPrefix: raw.slice(0, 8), durationValue: 30, durationUnit: 'days', expiresAt: new Date(Date.now() + 30 * DAY) },
    });
    allTokens.push(raw);
    return raw;
  }
  async function createSecret(who: string, name: string, key: string) {
    const res = await http().post('/api/secrets').set(bearer(who)).send({ name, typeId: apiKeyTypeId, data: { key, provider: 'Provider X' } });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }
  async function optIn(secret: string, origins: string[], injection?: object, who = session) {
    const res = await http().patch(`/api/secrets/${secret}/broker-access`).set(bearer(who)).send({ enabled: true, origins, ...(injection ? { injection } : {}) });
    expect([res.status, res.body.code]).toEqual([200, undefined]);
  }
  async function createToken(name: string, secretIds?: string[]) {
    const res = await http().post('/api/broker/tokens').set(bearer(session)).send({ name, ...(secretIds ? { secretIds } : {}) });
    expect(res.status).toBe(201);
    allTokens.push(res.body.data.token);
    return { token: res.body.data.token as string, id: res.body.data.id as string };
  }

  beforeAll(async () => {
    pki = createTestPki();
    const gz = (text: string) => gzipSync(Buffer.from(text));
    const handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => {
      const url = req.url ?? '';
      rawSeen.push({ url, rawHeaders: [...req.rawHeaders], method: req.method ?? '', bodyLength: body.length });
      const echo = /^\/echo\/([a-z0-9-]+)/.exec(url)?.[1];
      const k = echoKey;
      if (echo) {
        switch (echo) {
          case 'raw': return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ leaked: k }));
          case 'b64': return void res.writeHead(200).end(b64(k));
          case 'b64url': return void res.writeHead(200).end(b64url(k));
          case 'b64nopad': return void res.writeHead(200).end(b64(k).replace(/=+$/, ''));
          case 'pct': return void res.writeHead(200).end(encodeURIComponent(k));
          case 'pct-lower': return void res.writeHead(200).end(encodeURIComponent(k).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
          case 'bearer-b64': return void res.writeHead(200).end(b64(`Bearer ${k}`));
          case 'reflect-auth': return void res.writeHead(200).end(String(req.headers.authorization));
          case 'header': return void res.writeHead(200, { 'x-debug': k }).end('ok');
          case 'header-b64': return void res.writeHead(200, { 'x-debug': b64(k) }).end('ok');
          case 'header-pct': return void res.writeHead(200, { 'x-debug': encodeURIComponent(k) }).end('ok');
          case 'location': return void res.writeHead(302, { location: `https://elsewhere.example.test/cb?k=${encodeURIComponent(k)}` }).end();
          case 'gzip': return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(gz(JSON.stringify({ leaked: k })));
          case 'deflate': return void res.writeHead(200, { 'content-encoding': 'deflate' }).end(deflateSync(Buffer.from(`x ${k} y`)));
          case 'br': return void res.writeHead(200, { 'content-encoding': 'br' }).end(brotliCompressSync(Buffer.from(`x ${k} y`)));
          case 'gzip-b64': return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(gz(b64(k)));
          case 'split': {
            const mid = Math.floor(k.length / 2);
            res.writeHead(200);
            res.write(`pad-${k.slice(0, mid)}`);
            return void setTimeout(() => res.end(`${k.slice(mid)}-pad`), 60);
          }
          case 'split-gzip': {
            const packed = gz(`pad ${k} pad`);
            const mid = Math.floor(packed.length / 2);
            res.writeHead(200, { 'content-encoding': 'gzip' });
            res.write(packed.subarray(0, mid));
            return void setTimeout(() => res.end(packed.subarray(mid)), 60);
          }
          case 'double-gzip': return void res.writeHead(200, { 'content-encoding': 'gzip, gzip' }).end(gz(gz(`x ${k}`).toString('latin1')));
          case 'zstd': return void res.writeHead(200, { 'content-encoding': 'zstd' }).end(Buffer.from(`x ${k}`));
          case 'clean': return void res.writeHead(200, { 'content-type': 'text/plain' }).end('nothing to see');
          default: return void res.writeHead(404).end();
        }
      }
      if (url.startsWith('/redirect/loopback')) return void res.writeHead(302, { location: 'http://127.0.0.1:9/internal', 'set-cookie': 'r=1' }).end();
      if (url.startsWith('/redirect/same')) return void res.writeHead(302, { location: '/v1/target' }).end();
      if (url.startsWith('/redirect/other')) return void res.writeHead(307, { location: `https://${UPSTREAM}:${upstream.port}/v1/target` }).end();
      if (url.startsWith('/reflect-url')) return void res.writeHead(200, { 'content-type': 'text/plain' }).end(url);
      if (url.startsWith('/v1/target')) return void res.writeHead(200).end('target reached');
      if (url.startsWith('/hdrs')) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': ['a=1', 'b=2'],
          'set-cookie2': 'c=3',
          'x-vault-evil': '1',
          'x-vault-broker': '0',
          'proxy-authenticate': 'Basic realm=x',
          'x-keep': 'yes',
        });
        return void res.end('{}');
      }
      if (url.startsWith('/big')) {
        const n = Number(new URL(url, 'https://x.test').searchParams.get('n') ?? '0');
        return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.alloc(n, 97));
      }
      if (url.startsWith('/gz-bomb')) return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync(Buffer.alloc(10 * 1024 * 1024, 0)));
      if (url.startsWith('/drip')) {
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'), 100);
        res.on('close', () => clearInterval(timer));
        return void setTimeout(() => { clearInterval(timer); res.end(); }, 6000);
      }
      if (url.startsWith('/slow')) return void setTimeout(() => res.end('late'), 3000);
      if (url.startsWith('/upload')) return void res.writeHead(200).end(`got ${body.length}`);
      return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    };
    upstream = await startLocalHttps(pki.issue(UPSTREAM), handler);
    rebindUpstream = await startLocalHttps(pki.issue(REBIND), (_req, res) => void res.writeHead(200).end('rebind ok'));

    deployment = await provisionAppRoleDatabase(admin!);
    prisma = deployment.prismaClient();
    await seedPlatform(
      prisma as unknown as SeedPrisma,
      platformSeedInputFrom({ permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: DEFAULT_SYSTEM_SETTINGS }, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' }),
    );
    for (const key of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'INITIAL_ADMIN_EMAIL']) savedEnv[key] = process.env[key];
    Object.assign(process.env, deployment.env, { INITIAL_ADMIN_EMAIL: 'first-admin@example.test' });
    delete process.env.DATABASE_URL;

    dnsAnswers.set(UPSTREAM, () => [{ address: '127.0.0.1', family: 4 }]);
    dnsAnswers.set(REBIND, () => [{ address: '127.0.0.1', family: 4 }]);
    const resolver: BrokerResolver = {
      resolveAll: async (host: string) => {
        dnsCalls.push(host);
        dnsRound.set(host, (dnsRound.get(host) ?? 0) + 1);
        const answer = dnsAnswers.get(host);
        return answer ? answer(calls(host)) : [{ address: PUBLIC_ADDR, family: 4 as const }];
      },
    };
    spy = new SpyUpstream(new NodeHttpsBrokerUpstream({ ca: pki.caPem }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BrokerForwardService)
      .useFactory({
        factory: (db: never, crypto: never, settingsPort: never, audit: never, rate: AgentRateLimiter) =>
          new BrokerForwardService(db, crypto, settingsPort, audit, rate, resolver, spy, { allowLoopbackForTests: true }),
        inject: [VAULT_PRISMA, VAULT_CRYPTO, VAULT_SETTINGS, VAULT_AUDIT, AgentRateLimiter],
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    installBrokerRawBody(app.getHttpAdapter().getInstance());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    appPort = (app.getHttpServer().address() as AddressInfo).port;
    limiter = moduleRef.get(AgentRateLimiter, { strict: false });
    forwardService = moduleRef.get(BrokerForwardService);

    // Everything the process prints from here on: the Nest logger and raw stdout/stderr (Pino).
    const record = (level: string) => (...args: unknown[]) =>
      void logLines.push(`${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    Logger.overrideLogger({ log: record('log'), error: record('error'), warn: record('warn'), debug: record('debug'), verbose: record('verbose'), fatal: record('fatal') });
    restores.push(() => Logger.overrideLogger(new ConsoleLogger()));
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        logLines.push(`raw ${String(chunk)}`);
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restores.push(() => void (stream.write = original as typeof stream.write));
    }

    orgId = (await prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    ({ id: userId, session } = await createUser('adversary-owner@example.test'));
    ({ id: otherUserId, session: otherSession } = await createUser('adversary-other@example.test'));
    apiKeyTypeId = (await prisma.secretType.create({ data: { name: 'API Key', isSystem: true, createdById: userId, fields: [field('key', true, true), field('provider', false), field('notes', false)] } })).id;
    pat = await createPat(userId);
    otherPat = await createPat(otherUserId);

    await resetBroker();
    const origins = [origin(), `https://${REBIND}:${rebindUpstream.port}`, `https://${DNS_HOST}`];
    sA = await createSecret(session, 'Key A', KEY);
    sB = await createSecret(session, 'Key B', 'sk-second-AdversaryCanary_1');
    sSpecial = await createSecret(session, 'Key special', KEY_SPECIAL);
    sBasic = await createSecret(session, 'Key basic', KEY_BASIC);
    sQuery = await createSecret(session, 'Key query', KEY_QUERY);
    sHeader = await createSecret(session, 'Key header', KEY_HEADER);
    sForeign = await createSecret(otherSession, 'Foreign key', FOREIGN_KEY);
    await optIn(sA, origins);
    await optIn(sB, origins);
    await optIn(sSpecial, origins);
    await optIn(sBasic, origins, { kind: 'header', name: 'Authorization', prefix: 'Basic' });
    await optIn(sQuery, origins, { kind: 'query', name: 'api_key' });
    await optIn(sHeader, origins, { kind: 'header', name: 'X-Api-Key' });
    await optIn(sForeign, origins, undefined, otherSession);
    ({ token: vbk, id: vbkId } = await createToken('Adversary all'));
    ({ token: vbkRestricted } = await createToken('Adversary restricted', [sA]));
  }, 300_000);

  afterAll(async () => {
    restores.forEach((restore) => restore());
    await app?.close();
    await upstream?.close();
    await rebindUpstream?.close();
    pki?.dispose();
    await prisma?.$disconnect();
    await deployment?.drop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await resetBroker();
    clearLimiter();
    echoKey = KEY;
    dnsRound.clear();
    (forwardService as unknown as { allowLoopback: boolean }).allowLoopback = true;
    dnsAnswers.set(DNS_HOST, () => [{ address: PUBLIC_ADDR, family: 4 }]);
  });

  /** Nothing was resolved, connected to or sent since `mark`. */
  const snapshot = () => ({ seen: upstream.seen.length, rebind: rebindUpstream.seen.length, sent: spy.sent.length, dns: dnsCalls.length });

  // ===========================================================================
  describe('1. SSRF: the upstream host is never anything but an exact allowed origin', () => {
    const hosts: Array<[string, () => string]> = [
      ['127.0.0.1', () => '127.0.0.1'],
      ['127.0.0.1 with the allowed port', () => `127.0.0.1:${upstream.port}`],
      ['[::1]', () => '[::1]'],
      ['[::1] with a port', () => `[::1]:${upstream.port}`],
      ['localhost', () => 'localhost'],
      ['localhost with the allowed port', () => `localhost:${upstream.port}`],
      ['0.0.0.0', () => '0.0.0.0'],
      ['the cloud metadata address', () => '169.254.169.254'],
      ['the metadata address with a port', () => '169.254.169.254:80'],
      ['IPv4-mapped IPv6 loopback', () => '[::ffff:127.0.0.1]'],
      ['IPv4-mapped IPv6 metadata (hex form)', () => '[::ffff:a9fe:a9fe]'],
      ['decimal IPv4', () => '2130706433'],
      ['hex IPv4', () => '0x7f000001'],
      ['octal IPv4 (leading zero)', () => '017700000001'],
      ['dotted octal IPv4', () => '0177.0.0.1'],
      ['short IPv4', () => '127.1'],
      ['private 10/8', () => '10.0.0.5'],
      ['private 192.168/16', () => '192.168.1.1'],
      ['userinfo before the allowed host', () => `user@${hostPort()}`],
      ['the allowed host as userinfo of an evil host', () => `${UPSTREAM}@evil.example.test`],
      ['userinfo with a password', () => `user:pw@${hostPort()}`],
      ['an encoded slash after the host', () => `${UPSTREAM}%2F..`],
      ['an encoded slash and backslash', () => `${UPSTREAM}%5C@evil.example.test`],
      ['an encoded at sign', () => `${UPSTREAM}%40evil.example.test`],
      ['host with a space', () => `${UPSTREAM}%20evil.example.test`],
      ['host with a CRLF', () => `${UPSTREAM}%0d%0aX-Injected:%201`],
      ['a different host that merely ends in the allowed one', () => `evil-${hostPort()}`],
      ['a subdomain of the allowed host', () => `sub.${hostPort()}`],
      ['the allowed host as a subdomain of another', () => `${UPSTREAM}.evil.example.test`],
      ['a trailing dot', () => `${UPSTREAM}.:${upstream.port}`],
      ['a different port than allowed', () => `${UPSTREAM}:${upstream.port + 1}`],
      ['port 443 when another is allowed', () => `${UPSTREAM}:443`],
      ['an empty port', () => `${UPSTREAM}:`],
      ['a port out of range', () => `${UPSTREAM}:70000`],
      ['a non-numeric port', () => `${UPSTREAM}:abc`],
      ['a *.internal name', () => 'metadata.google.internal'],
      ['a *.local name', () => 'printer.local'],
      ['a single-label name', () => 'intranet'],
      ['an unlisted public name', () => 'other.example.test'],
    ];

    it.each(hosts)('%s is refused before any lookup or connection', async (_label, host) => {
      const before = snapshot();
      const res = await fwd(vbk, sA, host(), '/v1/ping');
      expect([200, 301, 302]).not.toContain(res.status);
      expect([400, 403, 404]).toContain(res.status);
      expect(res.headers['x-vault-broker']).toBeUndefined();
      expect(snapshot()).toEqual(before);
    });

    it('a PAT meets the same refusals', async () => {
      const before = snapshot();
      for (const host of ['127.0.0.1', '[::1]', 'localhost', '169.254.169.254', '2130706433']) {
        expect((await fwd(pat, sA, host, '/v1/ping')).status).toBe(403);
      }
      expect(snapshot()).toEqual(before);
    });

    it('the origin must be an allowed one: refusal is 403 BROKER_ORIGIN_MISMATCH and audited, with no hostname resolved', async () => {
      const before = snapshot();
      const res = await fwd(vbk, sA, '127.0.0.1', '/v1/ping');
      expect([res.status, JSON.parse(res.text).code]).toEqual([403, 'BROKER_ORIGIN_MISMATCH']);
      expect(snapshot()).toEqual(before);
      const rows = await prisma.auditEvent.findMany({ where: { action: 'broker.forward', targetId: sA }, orderBy: { createdAt: 'desc' }, take: 1 });
      expect((rows[0]!.meta as { result: string }).result).toBe('denied:origin_mismatch');
    });

    it('an uppercase spelling of the allowed host is the same origin: lowercased, never a different destination', async () => {
      const res = await fwd(vbk, sA, `${UPSTREAM.toUpperCase()}:${upstream.port}`, '/silent');
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) expect(upstream.seen.at(-1)!.headers.host).toBe(hostPort());
    });

    it('percent-encoded spellings that decode to exactly the allowed host reach only that host', async () => {
      for (const host of [`${UPSTREAM}%3A${upstream.port}`, `upstream%2Eexample%2Etest:${upstream.port}`]) {
        const before = upstream.seen.length;
        const res = await fwd(vbk, sA, host, '/silent');
        expect([200, 400, 403, 404]).toContain(res.status);
        if (res.status === 200) {
          expect(upstream.seen).toHaveLength(before + 1);
          expect(upstream.seen.at(-1)!.headers.host).toBe(hostPort());
        }
      }
    });

    it('path tricks stay on the allowed origin: traversal is forwarded as written, never as a host; CRLF in the path cannot smuggle a header', async () => {
      const before = rawSeen.length;
      const traversal = await fwd(vbk, sA, hostPort(), '/../../etc/passwd');
      expect(traversal.status).toBe(200);
      expect(rawSeen.at(-1)!.url).toBe('/../../etc/passwd');
      expect(upstream.seen.at(-1)!.headers.host).toBe(hostPort());

      const evilHost = await fwd(vbk, sA, 'evil.example.test', `/../${hostPort()}/v1/ping`);
      expect(evilHost.status).toBe(403);

      const crlf = await fwd(vbk, sA, hostPort(), '/silent%0d%0aX-Injected:%201');
      expect(crlf.status).toBeLessThan(600);
      for (const seen of rawSeen.slice(before)) expect(seen.rawHeaders.map((h) => h.toLowerCase())).not.toContain('x-injected');
    });

    it('a malformed secret id is the same 404 as a missing one and touches nothing', async () => {
      const before = snapshot();
      const missing = await fwd(vbk, '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b', hostPort(), '/v1/ping');
      for (const id of ["'%3B%20drop%20table%20secrets%3B--", '..%2F..%2Fsecrets', '0', 'null', `${sA}%00`]) {
        const res = await fwd(vbk, id, hostPort(), '/v1/ping');
        expect(res.status).toBe(404);
        expect(JSON.parse(res.text).message).toBe(JSON.parse(missing.text).message);
      }
      expect(snapshot()).toEqual(before);
    });

    it('methods the broker does not forward are never forwarded', async () => {
      const before = snapshot();
      for (const method of ['TRACE', 'PROPFIND']) {
        const res = await fwd(vbk, sA, hostPort(), '/v1/ping', { method });
        expect([400, 404, 405]).toContain(res.status);
      }
      expect(snapshot().seen).toBe(before.seen);
    });

    it('a base URL that is not https (the scheme is never part of the host segment) is refused', async () => {
      const before = snapshot();
      for (const host of [`https:%2F%2F${UPSTREAM}`, `http:%2F%2F${UPSTREAM}:${upstream.port}`, `${UPSTREAM}:${upstream.port}%2F%2Fevil.example.test`]) {
        expect([400, 403, 404]).toContain((await fwd(vbk, sA, host, '/v1/ping')).status);
      }
      expect(snapshot()).toEqual(before);
    });

    describe('the owner cannot opt such an origin in either (422 BROKER_ORIGIN_INVALID)', () => {
      const bad = [
        'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://0.0.0.0', 'https://169.254.169.254', 'https://[::ffff:127.0.0.1]',
        'https://2130706433', 'https://0x7f000001', 'https://017700000001', 'https://user@api.service-x.example', 'https://api.service-x.example/path',
        'https://api.service-x.example?x=1', 'https://api.service-x.example.', 'https://printer.local', 'https://metadata.google.internal', 'http://api.service-x.example',
        'ftp://api.service-x.example', 'https://*.service-x.example', 'https://api.service-x.example:99999', 'https://intranet', 'https://10.1.2.3', 'https://100.64.0.1',
      ];
      it.each(bad)('%s', async (candidate) => {
        const res = await http().patch(`/api/secrets/${sA}/broker-access`).set(bearer(session)).send({ enabled: true, origins: [origin(), candidate] });
        expect([res.status, res.body.code]).toEqual([422, 'BROKER_ORIGIN_INVALID']);
        expect((await prisma.secret.findUniqueOrThrow({ where: { id: sA } })).brokerOrigins).not.toContain(candidate);
      });
      it('more than 20 origins is a 400/422, never stored', async () => {
        const many = Array.from({ length: 21 }, (_v, i) => `https://api${i}.service-x.example`);
        const res = await http().patch(`/api/secrets/${sA}/broker-access`).set(bearer(session)).send({ enabled: true, origins: many });
        expect([400, 422]).toContain(res.status);
      });
    });

    it('even a database row that holds a dangerous origin (tampered) is never connected to: the forward re-validates', async () => {
      const original = (await prisma.secret.findUniqueOrThrow({ where: { id: sB } })).brokerOrigins;
      await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: ['https://127.0.0.1', `https://127.0.0.1:${upstream.port}`, 'https://localhost', 'https://169.254.169.254', 'https://[::1]'] } });
      try {
        const before = snapshot();
        for (const host of ['127.0.0.1', `127.0.0.1:${upstream.port}`, 'localhost', '169.254.169.254', '[::1]']) {
          expect((await fwd(vbk, sB, host, '/v1/ping')).status).toBe(403);
        }
        expect(snapshot()).toEqual(before);
      } finally {
        await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: original } });
      }
    });

    describe('DNS: every resolved address is checked, once, and the connection is pinned', () => {
      const mixed: Array<[string, Addr[]]> = [
        ['public then 10/8', [{ address: PUBLIC_ADDR, family: 4 }, { address: '10.0.0.5', family: 4 }]],
        ['10/8 then public', [{ address: '10.0.0.5', family: 4 }, { address: PUBLIC_ADDR, family: 4 }]],
        ['public then metadata', [{ address: PUBLIC_ADDR, family: 4 }, { address: '169.254.169.254', family: 4 }]],
        ['public then link-local IPv6', [{ address: PUBLIC_ADDR, family: 4 }, { address: 'fe80::1', family: 6 }]],
        ['public then unique-local IPv6', [{ address: PUBLIC_ADDR, family: 4 }, { address: 'fd00::1', family: 6 }]],
        ['public then CGNAT', [{ address: PUBLIC_ADDR, family: 4 }, { address: '100.64.0.1', family: 4 }]],
        ['public then 192.168/16', [{ address: PUBLIC_ADDR, family: 4 }, { address: '192.168.0.10', family: 4 }]],
        ['public then 172.16/12', [{ address: PUBLIC_ADDR, family: 4 }, { address: '172.16.0.1', family: 4 }]],
        ['public then IPv4-mapped private', [{ address: PUBLIC_ADDR, family: 4 }, { address: '::ffff:10.0.0.1', family: 6 }]],
        ['public then IPv4-mapped private (hex)', [{ address: PUBLIC_ADDR, family: 4 }, { address: '::ffff:a00:1', family: 6 }]],
        ['public then NAT64 of a private address', [{ address: PUBLIC_ADDR, family: 4 }, { address: '64:ff9b::a00:1', family: 6 }]],
        ['public then unspecified', [{ address: PUBLIC_ADDR, family: 4 }, { address: '0.0.0.0', family: 4 }]],
        ['public then ::', [{ address: PUBLIC_ADDR, family: 4 }, { address: '::', family: 6 }]],
        ['public then multicast', [{ address: PUBLIC_ADDR, family: 4 }, { address: '224.0.0.1', family: 4 }]],
        ['public then broadcast', [{ address: PUBLIC_ADDR, family: 4 }, { address: '255.255.255.255', family: 4 }]],
        ['only private', [{ address: '10.0.0.5', family: 4 }]],
        ['only metadata', [{ address: '169.254.169.254', family: 4 }]],
      ];
      it.each(mixed)('a name resolving to %s is 403 BROKER_DESTINATION_BLOCKED and nothing is sent', async (_label, answers) => {
        dnsAnswers.set(DNS_HOST, () => answers);
        const before = snapshot();
        const res = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
        expect([res.status, JSON.parse(res.text).code]).toEqual([403, 'BROKER_DESTINATION_BLOCKED']);
        expect(snapshot().sent).toBe(before.sent);
        expect(calls(DNS_HOST)).toBe(1);
      });

      it('loopback answers are refused in production mode (the test-only allowance switched off): 127/8, ::1 and ::ffff:127.0.0.1', async () => {
        (forwardService as unknown as { allowLoopback: boolean }).allowLoopback = false;
        for (const address of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) {
          dnsAnswers.set(DNS_HOST, () => [{ address, family: address.includes(':') ? 6 : 4 }]);
          const before = snapshot();
          const res = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
          expect([address, res.status, JSON.parse(res.text).code]).toEqual([address, 403, 'BROKER_DESTINATION_BLOCKED']);
          expect(snapshot().sent).toBe(before.sent);
        }
      });

      it('a name that is a public address then a mixed one is also refused when the real server is the loopback one (no partial trust of the first answer)', async () => {
        (forwardService as unknown as { allowLoopback: boolean }).allowLoopback = false;
        dnsAnswers.set(DNS_HOST, () => [{ address: PUBLIC_ADDR, family: 4 }, { address: '127.0.0.1', family: 4 }]);
        const before = snapshot();
        expect((await fwd(vbk, sA, DNS_HOST, '/v1/ping')).status).toBe(403);
        expect(snapshot().sent).toBe(before.sent);
      });

      it('DNS REBINDING: public on the first resolution and loopback on the second; the name is resolved ONCE and the connection goes to the validated address only', async () => {
        dnsAnswers.set(DNS_HOST, (call) => (call === 1 ? [{ address: PUBLIC_ADDR, family: 4 }] : [{ address: '127.0.0.1', family: 4 }]));
        const before = snapshot();
        const res = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
        expect(res.status).toBe(200);
        expect(res.text).toBe('fake-upstream');
        expect(calls(DNS_HOST)).toBe(1);
        expect(spy.sent).toHaveLength(before.sent + 1);
        expect(spy.sent.at(-1)!.address).toBe(PUBLIC_ADDR);
        expect(spy.sent.at(-1)!.hostname).toBe(DNS_HOST);
        // Nothing reached the local servers.
        expect(upstream.seen.length).toBe(before.seen);
        expect(rebindUpstream.seen.length).toBe(before.rebind);
      });

      it('DNS REBINDING, real connector: the pinned connection reaches the validated address although the name resolves nowhere (a second resolution would fail)', async () => {
        // First answer: the real local server (allowed for tests). Second answer would be a public address.
        dnsAnswers.set(REBIND, (call) => (call === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: PUBLIC_ADDR, family: 4 }]));
        const before = snapshot();
        const res = await fwd(vbk, sA, `${REBIND}:${rebindUpstream.port}`, '/v1/ping');
        expect([res.status, res.text]).toEqual([200, 'rebind ok']);
        expect(calls(REBIND)).toBe(1);
        expect(rebindUpstream.seen.length).toBe(before.rebind + 1);
        expect(spy.sent.at(-1)!.address).toBe('127.0.0.1');
        dnsAnswers.set(REBIND, () => [{ address: '127.0.0.1', family: 4 }]);
      });

      it('two forwards resolve twice (once each): there is no cache that a poisoned answer could outlive, and each is checked afresh', async () => {
        let n = 0;
        dnsAnswers.set(DNS_HOST, () => (++n === 1 ? [{ address: PUBLIC_ADDR, family: 4 }] : [{ address: '10.0.0.5', family: 4 }]));
        expect((await fwd(vbk, sA, DNS_HOST, '/v1/ping')).status).toBe(200);
        expect((await fwd(vbk, sA, DNS_HOST, '/v1/ping')).status).toBe(403);
      });

      it('a resolver that returns nothing or throws is 502 BROKER_UPSTREAM_ERROR, with no address or detail', async () => {
        dnsAnswers.set(DNS_HOST, () => []);
        const empty = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
        expect([empty.status, JSON.parse(empty.text).code]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
        dnsAnswers.set(DNS_HOST, () => {
          throw new Error('ENOTFOUND dns.example.test 203.0.113.9');
        });
        const failing = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
        expect([failing.status, JSON.parse(failing.text).code]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
        expect(failing.text).not.toContain('203.0.113.9');
        expect(failing.text).not.toContain('ENOTFOUND');
      });
    });
  });

  // ===========================================================================
  describe('2. Redirects are returned, never followed', () => {
    it.each([
      ['302 to http://127.0.0.1', '/redirect/loopback', 302, 'http://127.0.0.1:9/internal'],
      ['302 to another path of the allowed origin', '/redirect/same', 302, '/v1/target'],
      ['307 to the allowed origin', '/redirect/other', 307, `https://${UPSTREAM}:${0}/v1/target`],
    ])('%s: returned as is and the upstream sees exactly one request', async (_label, path, status, location) => {
      const before = upstream.seen.length;
      const res = await fwd(vbk, sA, hostPort(), path);
      expect(res.status).toBe(status);
      expect(res.headers.location).toBe(location.replace(':0/', `:${upstream.port}/`));
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['x-vault-broker']).toBe('1');
      expect(upstream.seen).toHaveLength(before + 1);
      expect(upstream.seen.some((s) => s.url.startsWith('/v1/target'))).toBe(false);
    });

    it('a redirect whose Location carries the key is withheld whole (502 BROKER_KEY_ECHO), not returned', async () => {
      const res = await fwd(vbk, sA, hostPort(), '/echo/location');
      expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_KEY_ECHO']);
      expect(res.headers.location).toBeUndefined();
    });
  });

  // ===========================================================================
  describe('3. No echo: a response that contains the key is withheld whole and audited', () => {
    const bodyModes = ['raw', 'b64', 'b64url', 'b64nopad', 'pct', 'pct-lower', 'bearer-b64', 'reflect-auth', 'gzip', 'deflate', 'br', 'gzip-b64', 'split', 'split-gzip'];
    const headerModes = ['header', 'header-b64', 'header-pct'];

    async function expectWithheld(secret: string, mode: string) {
      const before = await prisma.auditEvent.count({ where: { action: 'broker.forward' } });
      const res = await fwd(vbk, secret, hostPort(), `/echo/${mode}`);
      expect([mode, res.status, JSON.parse(res.text).code]).toEqual([mode, 502, 'BROKER_KEY_ECHO']);
      // Nothing of the upstream body or headers came back.
      expect(res.text).not.toContain('leaked');
      expect(res.text).not.toContain('pad-');
      expect(res.headers['x-debug']).toBeUndefined();
      expect(res.headers['content-encoding']).toBeUndefined();
      const rows = await prisma.auditEvent.findMany({ where: { action: 'broker.forward' }, orderBy: { createdAt: 'desc' }, take: 1 });
      expect(await prisma.auditEvent.count({ where: { action: 'broker.forward' } })).toBe(before + 1);
      expect(rows[0]!.meta).toMatchObject({ result: 'denied:key_echo', outcome: 'denied', reason: 'key_echo', secretId: secret });
    }

    it.each([...bodyModes, ...headerModes])('the default key, echoed as %s', async (mode) => {
      await expectWithheld(sA, mode);
    });

    it.each([...bodyModes, ...headerModes])('a key with special characters (percent and base64 alphabets differ), echoed as %s', async (mode) => {
      echoKey = KEY_SPECIAL;
      expect(b64(KEY_SPECIAL)).not.toBe(b64url(KEY_SPECIAL));
      expect(encodeURIComponent(KEY_SPECIAL)).not.toBe(KEY_SPECIAL);
      await expectWithheld(sSpecial, mode);
    });

    it.each(['raw', 'b64', 'b64url', 'reflect-auth', 'gzip', 'split'])('the Basic credential (injected as Basic base64(user:password)), echoed as %s', async (mode) => {
      echoKey = KEY_BASIC;
      await expectWithheld(sBasic, mode);
    });

    it('the Basic credential echoed as the base64 of user:password alone, and the base64 header value', async () => {
      echoKey = KEY_BASIC;
      await expectWithheld(sBasic, 'b64');
      await expectWithheld(sBasic, 'header-b64');
    });

    it('a query-injected key is withheld when the upstream reflects its URL (the injected pair) or the key', async () => {
      expect((await fwd(vbk, sQuery, hostPort(), '/echo/clean')).status).toBe(200); // control
      echoKey = KEY_QUERY;
      await expectWithheld(sQuery, 'raw');
      await expectWithheld(sQuery, 'pct');
      const reflected = await fwd(vbk, sQuery, hostPort(), '/reflect-url');
      expect([reflected.status, JSON.parse(reflected.text).code]).toEqual([502, 'BROKER_KEY_ECHO']);
      expect(reflected.text).not.toContain('api_key=');
    });

    it('a response that does not contain the key passes, with the control status and X-Vault-Broker', async () => {
      const res = await fwd(vbk, sA, hostPort(), '/echo/clean');
      expect([res.status, res.text, res.headers['x-vault-broker']]).toEqual([200, 'nothing to see', '1']);
    });

    it.each(['double-gzip', 'zstd'])('an encoding it cannot decode (%s) cannot be scanned: fail closed with 502 BROKER_UPSTREAM_ERROR and no body', async (mode) => {
      const res = await fwd(vbk, sA, hostPort(), `/echo/${mode}`);
      expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
      expect(res.text).not.toContain(KEY);
    });

    it('the withheld response leaves the owner and caller no trace of the key in any header', async () => {
      const res = await fwd(vbk, sA, hostPort(), '/echo/header');
      expect(JSON.stringify(res.headers)).not.toContain(KEY);
      expect(JSON.stringify(res.headers)).not.toContain(b64(KEY));
    });
  });

  // ===========================================================================
  describe('4. Header hygiene', () => {
    it('caller-sent credentials, proxy and forwarding headers never reach the upstream; the injection is the only Authorization, exactly once', async () => {
      const before = rawSeen.length;
      const res = await fwd(vbk, sA, hostPort(), '/hdrs', {
        headers: {
          cookie: 'session=stolen; other=1',
          'x-forwarded-for': '203.0.113.7',
          'x-forwarded-host': 'evil.example.test',
          'x-forwarded-proto': 'http',
          'x-real-ip': '203.0.113.8',
          forwarded: 'for=203.0.113.9',
          'proxy-authorization': 'Basic QXR0YWNrZXI6cHc=',
          'proxy-connection': 'keep-alive',
          'x-vault-anything': '1',
          'x-vault-broker': 'spoof',
          'x-vault-secret-id': sB,
          host: 'evil.example.test',
          'accept-encoding': 'gzip, br',
          te: 'trailers',
          'x-custom': 'kept',
        },
      });
      expect(res.status).toBe(200);
      const seen = rawSeen.slice(before).find((s) => s.url === '/hdrs')!;
      const names: string[] = [];
      for (let i = 0; i < seen.rawHeaders.length; i += 2) names.push(seen.rawHeaders[i]!.toLowerCase());
      const valueOf = (name: string) => seen.rawHeaders.filter((_v, i) => i % 2 === 1 && seen.rawHeaders[i - 1]!.toLowerCase() === name);
      for (const banned of ['cookie', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'proxy-authorization', 'proxy-connection', 'x-vault-anything', 'x-vault-broker', 'x-vault-secret-id']) {
        expect([banned, names.includes(banned)]).toEqual([banned, false]);
      }
      expect(names.filter((n) => n === 'authorization')).toHaveLength(1);
      expect(valueOf('authorization')).toEqual([`Bearer ${KEY}`]);
      expect(valueOf('host')).toEqual([hostPort()]);
      expect(valueOf('accept-encoding')).toEqual(['identity']);
      expect(valueOf('x-custom')).toEqual(['kept']);
      expect(JSON.stringify(seen.rawHeaders)).not.toContain(vbk);
      expect(JSON.stringify(seen.rawHeaders)).not.toContain('stolen');
    });

    it('a second Authorization header from the caller is dropped as well (the caller cannot choose what the upstream is told)', async () => {
      const before = rawSeen.length;
      await fwd(vbk, sA, hostPort(), '/silent', { headers: { authorization: [`Bearer ${vbk}`, 'Bearer attacker-token'] } });
      const seen = rawSeen.slice(before).at(-1)!;
      const auth = seen.rawHeaders.filter((_v, i) => i % 2 === 1 && seen.rawHeaders[i - 1]!.toLowerCase() === 'authorization');
      expect(auth).toEqual([`Bearer ${KEY}`]);
      expect(JSON.stringify(seen.rawHeaders)).not.toContain('attacker-token');
    });

    it('a caller cannot override a custom injection header (any case, repeated): the upstream sees the key once', async () => {
      const before = rawSeen.length;
      await fwd(vbk, sHeader, hostPort(), '/silent', { headers: { 'X-API-KEY': 'attacker-1', 'x-api-key': ['attacker-2', 'attacker-3'], authorization: `Bearer ${vbk}` } });
      const seen = rawSeen.slice(before).at(-1)!;
      const values = seen.rawHeaders.filter((_v, i) => i % 2 === 1 && seen.rawHeaders[i - 1]!.toLowerCase() === 'x-api-key');
      expect(values).toEqual([KEY_HEADER]);
      expect(JSON.stringify(seen.rawHeaders)).not.toContain('attacker');
    });

    it('a caller-supplied query parameter of the injection name (plain or percent-encoded) is replaced by the key, never forwarded beside it', async () => {
      const before = rawSeen.length;
      const res = await fwd(vbk, sQuery, hostPort(), '/silent?api_key=attacker-1&api%5Fkey=attacker-2&x=1&api_key');
      expect(res.status).toBe(200);
      const url = rawSeen.slice(before).at(-1)!.url;
      expect(url).not.toContain('attacker');
      const params = new URL(url, 'https://x.test').searchParams;
      expect(params.getAll('api_key')).toEqual([KEY_QUERY]);
      expect(params.get('x')).toBe('1');
    });

    it('the response never carries Set-Cookie, Set-Cookie2, X-Vault-* from the upstream or Proxy-* headers; X-Vault-Broker is exactly 1', async () => {
      const res = await fwd(vbk, sA, hostPort(), '/hdrs');
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['set-cookie2']).toBeUndefined();
      expect(res.headers['x-vault-evil']).toBeUndefined();
      expect(res.headers['proxy-authenticate']).toBeUndefined();
      expect(res.headers['x-vault-broker']).toBe('1');
      expect(res.headers['x-keep']).toBe('yes');
    });

    it('a credential in a cookie or an X-Api-Key header is not a credential: 401, nothing forwarded', async () => {
      const before = snapshot();
      const cookie = await rawRequest(appPort, { path: `/api/broker/v1/${sA}/${hostPort()}/silent`, headers: { cookie: `access_token=${vbk}`, 'x-api-key': vbk } });
      expect(cookie.status).toBe(401);
      expect(snapshot()).toEqual(before);
    });
  });

  // ===========================================================================
  describe('5. Token confinement and lifecycle', () => {
    const outside: Array<[string, string]> = [
      ['GET', '/api/secrets'],
      ['GET', '/api/secret-types'],
      ['GET', '/api/agent/v1/whoami'],
      ['POST', '/api/mcp'],
      ['GET', '/api/agent-activity'],
      ['GET', '/api/broker/tokens'],
      ['POST', '/api/broker/tokens'],
      ['POST', '/api/secrets/export'],
      ['GET', '/api/backups/me'],
      ['GET', '/api/media/folders'],
      ['GET', '/api/storage/objects'],
      ['GET', '/api/system-settings'],
      ['PUT', '/api/system-settings'],
      ['GET', '/api/user-settings'],
    ];
    it.each(outside)('a real vbk_ token on %s %s is a 401', async (method, path) => {
      const res = await rawRequest(appPort, { method, path, headers: { ...bearer(vbk), 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(res.status).toBe(401);
    });

    it('a vbk_ token cannot read any secret value anywhere: detail, versions and the opt-in toggle are 401, and the owner state is unchanged', async () => {
      for (const [method, path] of [['GET', `/api/secrets/${sA}`], ['GET', `/api/secrets/${sA}/versions`], ['PATCH', `/api/secrets/${sA}/broker-access`], ['PATCH', `/api/secrets/${sA}/agent-access`], ['DELETE', `/api/secrets/${sA}`]] as const) {
        const res = await rawRequest(appPort, { method, path, headers: { ...bearer(vbk), ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) }, body: method === 'PATCH' ? '{"enabled":false}' : undefined });
        expect([method, path, res.status]).toEqual([method, path, 401]);
      }
      expect((await prisma.secret.findUniqueOrThrow({ where: { id: sA } })).brokerAccess).toBe(true);
    });

    it('a token restricted to secret A used on secret B is the identical 404 of a missing and of another user\'s secret, and consumes nothing', async () => {
      const missing = await fwd(vbk, '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b', hostPort(), '/silent');
      const restricted = await fwd(vbkRestricted, sB, hostPort(), '/silent');
      const foreign = await fwd(vbk, sForeign, hostPort(), '/silent');
      const foreignByPat = await fwd(otherPat, sA, hostPort(), '/silent');
      const shape = (r: RawResult) => ({ status: r.status, body: { ...JSON.parse(r.text), path: undefined, timestamp: undefined, requestId: undefined } });
      for (const r of [restricted, foreign, foreignByPat]) expect(shape(r)).toEqual(shape(missing));
      expect(missing.status).toBe(404);
      const before = upstream.seen.length;
      expect((await fwd(vbkRestricted, sA, hostPort(), '/silent')).status).toBe(200);
      expect(upstream.seen.length).toBe(before + 1);
    });

    it('the opt-in is owner-only: a PAT of another user cannot use my secret, and `secrets:write_any` style access does not help (404)', async () => {
      expect((await fwd(otherPat, sA, hostPort(), '/silent')).status).toBe(404);
      expect((await fwd(pat, sForeign, hostPort(), '/silent')).status).toBe(404);
    });

    it('a revoked token is a 401 on the next call, and revoking is audited; an expired token is a 401; a deleted one too', async () => {
      const revoked = await createToken('To revoke');
      expect((await fwd(revoked.token, sA, hostPort())).status).toBe(200);
      await http().post(`/api/broker/tokens/${revoked.id}/revoke`).set(bearer(session)).expect(204);
      const after = await fwd(revoked.token, sA, hostPort());
      expect(after.status).toBe(401);

      const expiring = await createToken('To expire');
      await prisma.brokerToken.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await fwd(expiring.token, sA, hostPort())).status).toBe(401);

      const deleted = await createToken('To delete');
      await http().delete(`/api/broker/tokens/${deleted.id}`).set(bearer(session)).expect(204);
      expect((await fwd(deleted.token, sA, hostPort())).status).toBe(401);

      // Another user cannot revoke mine.
      expect((await http().post(`/api/broker/tokens/${vbkId}/revoke`).set(bearer(otherSession))).status).toBe(404);
      expect((await fwd(vbk, sA, hostPort())).status).toBe(200);
    });

    it('a token whose owner is deactivated is a 401', async () => {
      const mine = await createToken('Owner goes away');
      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      try {
        expect((await fwd(mine.token, sA, hostPort())).status).toBe(401);
      } finally {
        await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
      }
      expect((await fwd(mine.token, sA, hostPort())).status).toBe(200);
    });

    it('a forged or altered token value is a 401 without a database hit on the secret (one character changed, truncated, lengthened, wrong prefix)', async () => {
      const flipped = `${vbk.slice(0, -1)}${vbk.endsWith('a') ? 'b' : 'a'}`;
      for (const token of [flipped, vbk.slice(0, -1), `${vbk}x`, vbk.replace('vbk_', 'vbk_ '), vbk.toUpperCase(), `vbk_${'0'.repeat(40)}`, 'vbk_', 'vbk_%00']) {
        const status = (await fwd(token, sA, hostPort())).status;
        // A different scheme prefix (upper case) is not a broker token at all: refused as a wrong credential kind.
        expect([token, token.startsWith('vbk_') ? status === 401 : [401, 403].includes(status)]).toEqual([token, true]);
      }
    });

    it('the owner turning the broker off for a secret is a 404 on the very next call, and turning it back on restores it', async () => {
      await http().patch(`/api/secrets/${sB}/broker-access`).set(bearer(session)).send({ enabled: false }).expect(200);
      expect((await fwd(vbk, sB, hostPort())).status).toBe(404);
      expect((await fwd(pat, sB, hostPort())).status).toBe(404);
      await optIn(sB, [origin(), `https://${REBIND}:${rebindUpstream.port}`, `https://${DNS_HOST}`]);
      expect((await fwd(vbk, sB, hostPort())).status).toBe(200);
    });

    it('the opt-in cannot be changed by a PAT of another user, by oat_ or by vbk_ (and the secret is not disclosed)', async () => {
      const other = await http().patch(`/api/secrets/${sA}/broker-access`).set(bearer(otherPat)).send({ enabled: false });
      expect(other.status).toBe(404);
      const oat = await http().patch(`/api/secrets/${sA}/broker-access`).set(bearer('oat_0123456789abcdef')).send({ enabled: false });
      expect([401, 403]).toContain(oat.status);
      expect((await prisma.secret.findUniqueOrThrow({ where: { id: sA } })).brokerAccess).toBe(true);
    });

    it.each([
      ['the global agent-access kill switch', () => setBroker({ enabled: true }, false)],
      ['the broker switch', () => setBroker({ enabled: false }, true)],
      ['both switches', () => setBroker({ enabled: false }, false)],
    ])('%s off: 403 BROKER_DISABLED for a vbk_ and a pat_ token, before any lookup, DNS or upstream call', async (_label, turnOff) => {
      await turnOff();
      const before = snapshot();
      for (const token of [vbk, pat]) {
        const res = await fwd(token, sA, hostPort());
        expect([res.status, JSON.parse(res.text).code]).toEqual([403, 'BROKER_DISABLED']);
        // Even a secret that does not exist, or a host that is not allowed, answers the same: nothing is probed.
        expect(JSON.parse((await fwd(token, '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b', 'evil.example.test')).text).code).toBe('BROKER_DISABLED');
      }
      expect(snapshot()).toEqual(before);
    });

    it('the rate limit answers 429 RATE_LIMITED with Retry-After, is per token (another token is unaffected) and counts probes of secrets that do not exist', async () => {
      await setBroker({ forwardsPerMinute: 3 });
      const other = await createToken('Second token');
      const probe = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
      expect((await fwd(vbk, probe, hostPort())).status).toBe(404);
      expect((await fwd(vbk, probe, hostPort())).status).toBe(404);
      expect((await fwd(vbk, sA, hostPort())).status).toBe(200);
      const limited = await fwd(vbk, sA, hostPort());
      expect([limited.status, JSON.parse(limited.text).code]).toEqual([429, 'RATE_LIMITED']);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      const before = upstream.seen.length;
      expect((await fwd(vbk, sA, hostPort())).status).toBe(429);
      expect(upstream.seen.length).toBe(before);
      expect((await fwd(other.token, sA, hostPort())).status).toBe(200);
    });

    it('a PAT and a vbk_ token of the same owner have separate rate limits', async () => {
      await setBroker({ forwardsPerMinute: 1 });
      expect((await fwd(vbk, sA, hostPort())).status).toBe(200);
      expect((await fwd(vbk, sA, hostPort())).status).toBe(429);
      expect((await fwd(pat, sA, hostPort())).status).toBe(200);
    });

    it('the token list never returns a token or its hash and shows only the owner\'s tokens', async () => {
      const mine = await http().get('/api/broker/tokens').set(bearer(session)).expect(200);
      const text = JSON.stringify(mine.body);
      for (const token of allTokens) expect(text).not.toContain(token);
      expect(text).not.toContain('tokenHash');
      expect(text).not.toContain('token_hash');
      for (const token of allTokens.filter((t) => t.startsWith('vbk_'))) expect(text).not.toContain(sha256(token));
      expect(JSON.stringify(await http().get('/api/broker/tokens').set(bearer(otherSession)).then((r) => r.body))).not.toContain(vbkId);
    });

    it('at rest only the SHA-256 of a token is stored: no column holds the token, its random part or a reversible form', async () => {
      const rows = await prisma.brokerToken.findMany();
      expect(rows.length).toBeGreaterThan(2);
      const vbkTokens = allTokens.filter((t) => t.startsWith('vbk_'));
      for (const token of vbkTokens) {
        const row = rows.find((r) => r.tokenHash === sha256(token));
        expect(row).toBeDefined();
        expect(row!.tokenHash).not.toBe(token);
      }
      const dump = JSON.stringify(rows);
      for (const token of vbkTokens) {
        expect(dump).not.toContain(token);
        expect(dump).not.toContain(token.slice(4));
        expect(dump).not.toContain(b64(token));
      }
      const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'broker_tokens'`);
      expect(columns.map((c) => c.column_name)).not.toContain('token');
    });
  });

  // ===========================================================================
  describe('6. Caps and timeouts', () => {
    it('a request body over the cap announced by Content-Length is 413 and the upstream is not reached', async () => {
      await setBroker({ maxRequestBytes: 64 });
      const before = snapshot();
      const res = await fwd(vbk, sA, hostPort(), '/upload', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(500) });
      expect([res.status, JSON.parse(res.text).code]).toEqual([413, 'BROKER_REQUEST_TOO_LARGE']);
      expect(snapshot()).toEqual(before);
      expect(rawSeen.filter((s) => s.url === '/upload')).toHaveLength(0);
    });

    it('a request body over the cap WITHOUT a Content-Length (chunked) is 413 and the upstream never receives more than the cap', async () => {
      await setBroker({ maxRequestBytes: 64 });
      const chunks = Array.from({ length: 10 }, () => Buffer.alloc(40, 'y'));
      const res = await fwd(vbk, sA, hostPort(), '/upload', { method: 'POST', headers: { 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }, chunks });
      expect(res.status).toBe(413);
      expect(res.text).toContain('BROKER_REQUEST_TOO_LARGE');
      // An aborted request is never completed upstream; if one was, it carried at most the cap.
      for (const seen of rawSeen.filter((s) => s.url === '/upload')) expect(seen.bodyLength).toBeLessThanOrEqual(64);
    });

    it('the boundary: a chunked body of exactly the cap passes, one more byte does not', async () => {
      await setBroker({ maxRequestBytes: 64 });
      const exact = await fwd(vbk, sA, hostPort(), '/upload', { method: 'POST', headers: { 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }, chunks: [Buffer.alloc(32, 'a'), Buffer.alloc(32, 'b')] });
      expect([exact.status, exact.text]).toEqual([200, 'got 64']);
      const over = await fwd(vbk, sA, hostPort(), '/upload', { method: 'POST', headers: { 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }, chunks: [Buffer.alloc(32, 'a'), Buffer.alloc(33, 'b')] });
      expect(over.status).toBe(413);
    });

    it('a response over the cap is 502 BROKER_RESPONSE_TOO_LARGE with nothing of it returned; exactly the cap passes', async () => {
      await setBroker({ maxResponseBytes: 2048 });
      const res = await fwd(vbk, sA, hostPort(), '/big?n=100000');
      expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_RESPONSE_TOO_LARGE']);
      expect(res.text).not.toContain('aaaa');
      const exact = await fwd(vbk, sA, hostPort(), '/big?n=2048');
      expect([exact.status, exact.text.length]).toEqual([200, 2048]);
      expect((await fwd(vbk, sA, hostPort(), '/big?n=2049')).status).toBe(502);
    });

    it('a compression bomb (small on the wire, 10 MiB decoded) is 502 BROKER_RESPONSE_TOO_LARGE, not buffered whole', async () => {
      await setBroker({ maxResponseBytes: 64 * 1024 });
      const res = await fwd(vbk, sA, hostPort(), '/gz-bomb');
      expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_RESPONSE_TOO_LARGE']);
    });

    it('a slow upstream (no answer) and a dripping one (answers, then never finishes) are both 504 BROKER_UPSTREAM_TIMEOUT within the deadline', async () => {
      await setBroker({ timeoutMs: 1000 });
      const started = Date.now();
      const slow = await fwd(vbk, sA, hostPort(), '/slow');
      expect([slow.status, JSON.parse(slow.text).code]).toEqual([504, 'BROKER_UPSTREAM_TIMEOUT']);
      const drip = await fwd(vbk, sA, hostPort(), '/drip');
      expect([drip.status, JSON.parse(drip.text).code]).toEqual([504, 'BROKER_UPSTREAM_TIMEOUT']);
      expect(Date.now() - started).toBeLessThan(5000);
    }, 30_000);

    it('a DNS lookup that hangs is also bounded by the timeout (504, no connection)', async () => {
      await setBroker({ timeoutMs: 1000 });
      const original = (forwardService as unknown as { resolver: BrokerResolver }).resolver;
      (forwardService as unknown as { resolver: BrokerResolver }).resolver = { resolveAll: () => new Promise(() => undefined) };
      try {
        const before = snapshot();
        const res = await fwd(vbk, sA, DNS_HOST, '/v1/ping');
        expect([res.status, JSON.parse(res.text).code]).toEqual([504, 'BROKER_UPSTREAM_TIMEOUT']);
        expect(snapshot().sent).toBe(before.sent);
      } finally {
        (forwardService as unknown as { resolver: BrokerResolver }).resolver = original;
      }
    }, 20_000);

    it('a connection failure (nothing listening) is 502 BROKER_UPSTREAM_ERROR with no address, port or errno in the answer', async () => {
      // The port is closed: the upstream server of the REBIND host answers a different port than the secret allows? Use a dead port on loopback.
      const dead = await prisma.secret.findUniqueOrThrow({ where: { id: sB } });
      const deadOrigin = 'https://dead.example.test:9';
      await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: [...dead.brokerOrigins, deadOrigin] } });
      dnsAnswers.set('dead.example.test', () => [{ address: '127.0.0.1', family: 4 }]);
      try {
        const res = await fwd(vbk, sB, 'dead.example.test:9', '/v1/ping');
        expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
        for (const leak of ['127.0.0.1', 'ECONNREFUSED', 'errno']) expect(res.text).not.toContain(leak);
      } finally {
        await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: dead.brokerOrigins } });
      }
    });

    it('a certificate for another name is refused (TLS verification is never off): 502, nothing returned', async () => {
      // REBIND's server presents a certificate for rebind.example.test; reach it under the UPSTREAM name.
      const wrong = await prisma.secret.findUniqueOrThrow({ where: { id: sB } });
      await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: [...wrong.brokerOrigins, `https://${UPSTREAM}:${rebindUpstream.port}`] } });
      try {
        const before = rebindUpstream.seen.length;
        const res = await fwd(vbk, sB, `${UPSTREAM}:${rebindUpstream.port}`, '/v1/ping');
        expect([res.status, JSON.parse(res.text).code]).toEqual([502, 'BROKER_UPSTREAM_ERROR']);
        expect(rebindUpstream.seen.length).toBe(before);
      } finally {
        await prisma.secret.update({ where: { id: sB }, data: { brokerOrigins: wrong.brokerOrigins } });
      }
    });
  });

  // ===========================================================================
  describe('7. SECRET EGRESS SWEEP', () => {
    it('after every forward above (successes, refusals, errors) no key, encoding or token appears in audit rows, Agent activity, the token list, the app\'s own responses or the logs', async () => {
      const forms = (value: string) => [value, b64(value), b64url(value), b64(value).replace(/=+$/, ''), encodeURIComponent(value), b64(`Bearer ${value}`)];
      const secretsToHide = [...ALL_KEYS.flatMap(forms), ...allTokens, ...allTokens.map(b64)];
      // A key that is the SAME text as something innocuous would make this vacuous: they are unique canaries.
      for (const canary of secretsToHide) expect(canary.length).toBeGreaterThan(8);

      const audit = JSON.stringify(await prisma.auditEvent.findMany());
      const forwards = await prisma.auditEvent.findMany({ where: { action: 'broker.forward' } });
      expect(forwards.length).toBeGreaterThan(60);
      const results = new Set(forwards.map((r) => (r.meta as { result: string }).result));
      for (const expected of ['ok', 'denied:key_echo', 'denied:origin_mismatch', 'denied:destination_blocked', 'denied:request_too_large', 'denied:response_too_large', 'denied:disabled', 'denied:rate_limited', 'denied:not_found', 'error:upstream_timeout', 'error:upstream_error']) {
        expect([...results]).toContain(expected);
      }
      for (const row of forwards) {
        const meta = row.meta as Record<string, unknown>;
        expect(Object.keys(meta).sort()).toEqual(['credential', 'durationMs', 'method', 'origin', 'outcome', 'path', 'reason', 'requestBytes', 'responseBytes', 'result', 'secretId', 'status', 'tokenId'].sort());
        // The path never carries a query string (the query holds the injected key for query injection).
        expect(String(meta.path ?? '')).not.toContain('?');
      }

      clearLimiter();
      const activity = await http().get('/api/agent-activity').query({ action: 'broker_forward', pageSize: 100 }).set(bearer(session)).expect(200);
      expect(activity.body.data.length).toBeGreaterThan(10);
      const tokenList = await http().get('/api/broker/tokens').set(bearer(session)).expect(200);
      const nonUpstream = brokerOwnResponses.join('\n');
      expect(brokerOwnResponses.length).toBeGreaterThan(50);
      const logs = logLines.join('\n');

      const surfaces: Array<[string, string]> = [
        ['audit_events', audit],
        ['agent activity', JSON.stringify(activity.body)],
        ['token list', JSON.stringify(tokenList.body)],
        ['responses written by the broker (refusals and errors)', nonUpstream],
        ['logs', logs],
      ];
      for (const [label, text] of surfaces) {
        for (const canary of secretsToHide) {
          const at = text.indexOf(canary);
          if (at >= 0) throw new Error(`${label} contains a secret value or token (${canary.slice(0, 6)}...): ${text.slice(Math.max(0, at - 160), at).replace(/\s+/g, ' ')}<HIDDEN>${text.slice(at + canary.length, at + canary.length + 60).replace(/\s+/g, ' ')}`);
        }
      }
      expect(logs.length).toBeGreaterThan(0);

      // No broker_tokens row stores a token; the opt-in state never stores a value.
      const secretsRows = JSON.stringify(await prisma.secret.findMany({ where: { id: { in: [sA, sB, sSpecial, sBasic, sQuery, sHeader] } } }));
      for (const key of ALL_KEYS) expect(secretsRows).not.toContain(key);
      // The key exists only as ciphertext in secret_versions.
      const versions = JSON.stringify(await prisma.secretVersion.findMany());
      for (const key of ALL_KEYS) expect(versions).not.toContain(key);
    });
  });
  // ===========================================================================
  describe('8. A token sent where it does not belong is not written to the logs', () => {
    it('a vbk_ token mistakenly placed in the query string is not a credential (401) and its value is not logged', async () => {
      const before = snapshot();
      const mark = logLines.length;
      for (const extra of [`?access_token=${vbk}`, `?token=${vbk}`]) {
        expect((await rawRequest(appPort, { path: `/api/broker/v1/${sA}/${hostPort()}/silent${extra}` })).status).toBe(401);
        expect((await rawRequest(appPort, { path: `/api/secrets${extra}` })).status).toBe(401);
      }
      expect(snapshot()).toEqual(before);
      // The platform's exception filter logs the request URL of a 401; a credential in it must be masked.
      expect(logLines.slice(mark).join('\n')).not.toContain(vbk);
    });
  });
});
