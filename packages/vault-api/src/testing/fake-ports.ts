import { Readable } from 'node:stream';

import type {
  VaultAiConfigPort,
  VaultAiKeyPresencePort,
  VaultAiPort,
  VaultJobsPort,
  VaultMetricsPort,
  VaultNotifyPort,
  VaultObjectsPort,
  VaultObjectStorePort,
  VaultPrismaClient,
  VaultSettingsPort,
} from '../ports';
import type { VaultApiBindings } from '../vault-api.module';
import { TestCrypto } from './fake-crypto';
import { InMemoryAudit } from './fake-audit';

// =============================================================================
// In-memory fakes of the ports, and the bindings that wire them
// =============================================================================
//
// For the package's own conformance run and for a host that wants to boot the module without a
// database, a queue or an object store. Nothing here touches the network or the disk.
// =============================================================================

/** A Prisma stand-in whose every model operation fails loudly: the module can boot over it, a slice cannot use it. */
export function createUnusablePrisma(): VaultPrismaClient {
  const fail = (path: string) => () => {
    throw new Error(`createUnusablePrisma: ${path} was called; stub the client for a behaviour test`);
  };
  const model = (name: string) => new Proxy({}, { get: (_t, op) => (typeof op === 'string' ? fail(`${name}.${op}`) : undefined) });
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string' || key === 'then') return undefined;
        return key.startsWith('$') ? fail(key) : model(key);
      },
    },
  ) as unknown as VaultPrismaClient;
}

/** An object store in a Map. */
export class InMemoryObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly bucket = 'test-bucket';

  async upload(key: string, stream: Readable | Buffer): Promise<{ key: string; bucket: string; location: string; eTag: string }> {
    const chunks: Buffer[] = [];
    if (Buffer.isBuffer(stream)) chunks.push(stream);
    else for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    this.objects.set(key, Buffer.concat(chunks));
    return { key, bucket: this.bucket, location: `s3://${this.bucket}/${key}`, eTag: '"fake"' };
  }

  async download(key: string): Promise<Readable> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`NoSuchKey: ${key}`);
    return Readable.from([body]);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  getBucket(): string {
    return this.bucket;
  }

  async getSignedDownloadUrl(key: string): Promise<string> {
    return `https://storage.example.test/${this.bucket}/${key}?signed=1`;
  }
}

/** A queue that records what was enqueued and which handlers registered. */
export class RecordingJobs {
  readonly enqueued: Array<{ type: string; input: unknown }> = [];
  readonly handlers = new Map<string, unknown>();

  enqueue: VaultJobsPort['enqueue'] = async (input) => {
    this.enqueued.push({ type: input.type, input });
    return { id: `job-${this.enqueued.length}`, type: input.type } as never;
  };

  enqueueWithin: VaultJobsPort['enqueueWithin'] = async (_tx, input) => this.enqueue(input);

  registerHandler: VaultJobsPort['registerHandler'] = (handler) => {
    if (this.handlers.has(handler.type)) throw new Error(`duplicate job type ${handler.type}`);
    this.handlers.set(handler.type, handler);
  };
}

/** A dispatcher that records the events it was asked to raise. */
export class RecordingNotify {
  readonly sent: Array<{ event: string; target: string; data: unknown }> = [];

  notify: VaultNotifyPort['notify'] = async (event, userId, data) => {
    this.sent.push({ event, target: userId, data });
  };

  notifyNow: VaultNotifyPort['notifyNow'] = async (event, userId, data) => {
    this.sent.push({ event, target: userId, data });
    return {} as never;
  };

  notifyPermissionHolders: VaultNotifyPort['notifyPermissionHolders'] = async (event, permission, data) => {
    this.sent.push({ event, target: `permission:${permission}`, data });
  };
}

/** Settings from a plain object keyed by namespace. */
export class FakeSettings implements VaultSettingsPort {
  constructor(private readonly namespaces: Record<string, unknown> = {}) {}

  async getNamespace<T = Record<string, unknown>>(name: string): Promise<T> {
    return (this.namespaces[name] ?? {}) as T;
  }

  async getSettings(): Promise<unknown> {
    return { ...this.namespaces };
  }
}

/** Metrics that count calls by method. */
export class CountingMetrics implements VaultMetricsPort {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  secretCreated = (...args: Parameters<VaultMetricsPort['secretCreated']>) => void this.calls.push({ method: 'secretCreated', args });
  secretVersionCreated = (...args: Parameters<VaultMetricsPort['secretVersionCreated']>) => void this.calls.push({ method: 'secretVersionCreated', args });
  backupFinished = (...args: Parameters<VaultMetricsPort['backupFinished']>) => void this.calls.push({ method: 'backupFinished', args });
  cardExtracted = (...args: Parameters<VaultMetricsPort['cardExtracted']>) => void this.calls.push({ method: 'cardExtracted', args });
}

/** The set of fakes behind {@link createFakeBindings}, kept so a test can inspect them. */
export interface FakeVaultPorts {
  prisma: VaultPrismaClient;
  crypto: TestCrypto;
  objectStore: InMemoryObjectStore;
  jobs: RecordingJobs;
  notify: RecordingNotify;
  audit: InMemoryAudit;
  settings: FakeSettings;
  metrics: CountingMetrics;
}

/**
 * Bindings for `VaultApiModule.forRoot` made of the fakes above. The AI ports answer "not configured":
 * a test that needs a scripted model overrides `ai`.
 */
export function createFakeBindings(overrides: Partial<FakeVaultPorts> = {}): { bindings: VaultApiBindings; ports: FakeVaultPorts } {
  const ports: FakeVaultPorts = {
    prisma: createUnusablePrisma(),
    crypto: new TestCrypto(),
    objectStore: new InMemoryObjectStore(),
    jobs: new RecordingJobs(),
    notify: new RecordingNotify(),
    audit: new InMemoryAudit(),
    settings: new FakeSettings(),
    metrics: new CountingMetrics(),
    ...overrides,
  };
  const objects: VaultObjectsPort = {
    delete: async () => undefined,
    getDownloadUrl: async () => ({ url: 'https://storage.example.test/signed', expiresIn: 300 }),
  };
  const ai: VaultAiPort = {
    forUser: () => {
      throw new Error('fake AI: not configured');
    },
  };
  const aiConfig: VaultAiConfigPort = {
    describePublic: async () => ({ enabled: false, providers: [], keyPolicy: 'byok_with_org_fallback' }) as never,
  };
  const aiKeyPresence: VaultAiKeyPresencePort = { isConfigured: async () => false };
  return {
    ports,
    bindings: {
      prisma: { useValue: ports.prisma },
      crypto: { useValue: ports.crypto },
      objectStore: { useValue: ports.objectStore as unknown as VaultObjectStorePort },
      objects: { useValue: objects },
      jobs: { useValue: ports.jobs },
      notify: { useValue: ports.notify },
      ai: { useValue: ai },
      aiConfig: { useValue: aiConfig },
      aiKeyPresence: { useValue: aiKeyPresence },
      audit: { useValue: ports.audit },
      settings: { useValue: ports.settings },
      metrics: { useValue: ports.metrics },
    },
  };
}
