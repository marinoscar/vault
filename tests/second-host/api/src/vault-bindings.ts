// =============================================================================
// Host Beta's bindings for every Vault port (docs/EMBEDDING.md, "What a host provides")
// =============================================================================
//
// Each one is the HOST's: its own cipher and key (not VAULT_ENCRYPTION_KEY), its own object store,
// its own audit writer, its own settings, its own metric names. None reads anything of Vault's.
//
//   VAULT_PRISMA          PrismaService (the host's generated client, ordinary role)
//   VAULT_CRYPTO          HostBetaCipher: AES-256-GCM, a key ring with key ids (rotation-ready)
//   VAULT_OBJECT_STORE    HostBetaObjectStore (in memory: the fixture has no S3)
//   VAULT_OBJECTS         HostBetaObjects (row plus blob, uploader-ownership check)
//   VAULT_JOBS            HostBetaJobs over the platform queue
//   VAULT_NOTIFY          HostBetaNotifier: records and logs (the host mounts no notifications slice)
//   VAULT_AI / _CONFIG / _KEY_PRESENCE   "no AI in this host"
//   VAULT_AUDIT           HostBetaAudit over `audit_events`; a failed write is NOT swallowed
//   VAULT_SETTINGS        HostBetaVaultSettings: the host's own store (agent access on)
//   VAULT_METRICS         HostBetaMetrics: the host's own metric names (`app.beta.secrets.*`)
//   VAULT_MCP_OPTIONS     the host's URL for the MCP Origin rule
//   VAULT_HOST            the host's URL for notification links
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { ForbiddenException, Global, Injectable, Logger, Module, NotFoundException } from '@nestjs/common';
import { AiConfigService } from '@marinoscar/platform-api/ai';
import { JobHandlerRegistry, JobsService } from '@marinoscar/platform-api/jobs';
import { AGENT_ACCESS_SETTINGS_DEFAULTS } from '@marinoscar/vault-contract/agent';
import { VAULT_BACKUPS_SETTINGS_DEFAULTS, VAULT_CARDS_SETTINGS_DEFAULTS } from '@marinoscar/vault-api/core';
import type {
  VaultAiConfigPort,
  VaultAiKeyPresencePort,
  VaultAiPort,
  VaultAuditEvent,
  VaultAuditPort,
  VaultCryptoPort,
  VaultEncryptedData,
  VaultHostConfig,
  VaultJobsPort,
  VaultMetricsPort,
  VaultNotifyPort,
  VaultObjectsPort,
  VaultObjectStorePort,
  VaultSettingsPort,
} from '@marinoscar/vault-api/ports';

import { HOST_APP_URL } from './host-identity';
import { PrismaService } from './prisma.service';

// -----------------------------------------------------------------------------
// VAULT_CRYPTO
// -----------------------------------------------------------------------------

/**
 * AES-256-GCM under the HOST's key ring (`HOST_BETA_DATA_KEYS`, `kid:base64key,...`, the first is
 * current). The ciphertext carries its key id (`<kid>.<base64>`), so a new key can be added and made
 * current without re-encrypting old rows: rotation is "add a key, re-encrypt in the background".
 * Authenticated (the tag is checked on every decrypt); a plaintext is never logged or kept.
 */
export class HostBetaCipher implements VaultCryptoPort {
  private readonly keys = new Map<string, Buffer>();
  private readonly current: string;

  constructor(spec: string) {
    for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [kid, b64] = entry.split(':');
      const key = Buffer.from(b64 ?? '', 'base64');
      if (!kid || key.length !== 32) throw new Error('HOST_BETA_DATA_KEYS: each entry is <kid>:<32-byte base64 key>');
      this.keys.set(kid, key);
    }
    const first = this.keys.keys().next();
    if (first.done) throw new Error('HOST_BETA_DATA_KEYS is empty');
    this.current = first.value;
  }

  encrypt(plaintext: string): VaultEncryptedData {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext: `${this.current}.${ciphertext.toString('base64')}`, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  }

  decrypt(ciphertext: string, iv: string, authTag: string): string {
    const dot = ciphertext.indexOf('.');
    const key = dot > 0 ? this.keys.get(ciphertext.slice(0, dot)) : undefined;
    if (!key) throw new Error('HostBetaCipher: unknown key id');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext.slice(dot + 1), 'base64')), decipher.final()]).toString('utf8');
  }
}

// -----------------------------------------------------------------------------
// VAULT_OBJECT_STORE and VAULT_OBJECTS
// -----------------------------------------------------------------------------

/** The host's object store: in memory (a real host binds the platform storage slice's provider). */
@Injectable()
export class HostBetaObjectStore implements VaultObjectStorePort {
  readonly blobs = new Map<string, Buffer>();
  private readonly bucket = 'hostbeta-objects';

  async upload(key: string, body: unknown): Promise<never> {
    const chunks: Buffer[] = [];
    if (Buffer.isBuffer(body)) chunks.push(body);
    else for await (const chunk of body as Readable) chunks.push(Buffer.from(chunk));
    this.blobs.set(key, Buffer.concat(chunks));
    return { key, bucket: this.bucket, location: `memory://${this.bucket}/${key}`, eTag: '"hostbeta"' } as never;
  }

  async download(key: string): Promise<Readable> {
    const body = this.blobs.get(key);
    if (!body) throw new NotFoundException(`no object ${key}`);
    return Readable.from([body]);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }

  getBucket(): string {
    return this.bucket;
  }

  async getSignedDownloadUrl(key: string): Promise<string> {
    return `${HOST_APP_URL}/objects/${encodeURIComponent(key)}?signed=1`;
  }
}

/** `VAULT_OBJECTS`: a storage object (row and blob) the user uploaded. */
@Injectable()
export class HostBetaObjects implements VaultObjectsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: HostBetaObjectStore,
  ) {}

  private async owned(id: string, userId: string, orgId: string, any = false) {
    const row = await this.prisma.runInOrg(orgId, (tx) =>
      (tx as PrismaService).storageObject.findUnique({ where: { id }, select: { id: true, storageKey: true, uploadedById: true } }),
    );
    if (!row || (!any && row.uploadedById !== userId)) throw new NotFoundException('Storage object not found');
    return row;
  }

  async delete(id: string, userId: string, orgId: string, options?: { canDeleteAny?: boolean }): Promise<void> {
    const row = await this.owned(id, userId, orgId, options?.canDeleteAny === true);
    await this.store.delete(row.storageKey);
    await this.prisma.runInOrg(orgId, (tx) => (tx as PrismaService).storageObject.delete({ where: { id } }));
  }

  async getDownloadUrl(id: string, userId: string, orgId: string, expiresIn = 300): Promise<{ url: string; expiresIn: number }> {
    const row = await this.owned(id, userId, orgId);
    return { url: await this.store.getSignedDownloadUrl(row.storageKey), expiresIn };
  }
}

// -----------------------------------------------------------------------------
// VAULT_JOBS, VAULT_NOTIFY, VAULT_AUDIT, VAULT_SETTINGS, VAULT_METRICS
// -----------------------------------------------------------------------------

/** The platform queue: `JobsService` enqueues, the registry takes the package's handlers. */
@Injectable()
export class HostBetaJobs implements VaultJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  enqueue: VaultJobsPort['enqueue'] = (input) => this.jobs.enqueue(input);
  enqueueWithin: VaultJobsPort['enqueueWithin'] = (tx, input) => this.jobs.enqueueWithin(tx, input);
  registerHandler: VaultJobsPort['registerHandler'] = (handler) => this.registry.register(handler);
}

/** Records every event the slices raise and logs its key (never its payload). */
@Injectable()
export class HostBetaNotifier implements VaultNotifyPort {
  private readonly logger = new Logger('HostBetaNotifier');
  readonly raised: Array<{ event: string; target: string }> = [];

  private note(event: string, target: string): void {
    this.raised.push({ event, target });
    this.logger.log(`notification ${event} for ${target}`);
  }

  notify: VaultNotifyPort['notify'] = async (event, userId) => this.note(event, userId);
  notifyCounted: VaultNotifyPort['notifyCounted'] = async (event, userId) => this.note(event, userId);
  notifyNow: VaultNotifyPort['notifyNow'] = async (event, userId) => {
    this.note(event, userId);
    return {} as never;
  };
  notifyPermissionHolders: VaultNotifyPort['notifyPermissionHolders'] = async (event, permission) => this.note(event, `permission:${permission}`);
}

/** One `audit_events` row per record. A failure propagates: the caller decides, never this adapter. */
@Injectable()
export class HostBetaAudit implements VaultAuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: VaultAuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        ...(event.actorUserId !== undefined ? { actorUserId: event.actorUserId } : {}),
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.meta !== undefined ? { meta: event.meta as never } : {}),
      },
    });
  }
}

/** The host keeps Vault's settings itself (no platform settings namespace); the agent API is on. */
@Injectable()
export class HostBetaVaultSettings implements VaultSettingsPort {
  private readonly namespaces: Record<string, unknown> = {
    vaultCards: { ...VAULT_CARDS_SETTINGS_DEFAULTS },
    vaultBackups: { ...VAULT_BACKUPS_SETTINGS_DEFAULTS },
    agentAccess: { ...AGENT_ACCESS_SETTINGS_DEFAULTS, enabled: true },
    ai: {},
  };

  async getNamespace<T = Record<string, unknown>>(name: string): Promise<T> {
    return structuredClone(this.namespaces[name] ?? {}) as T;
  }

  async getSettings(): Promise<unknown> {
    return structuredClone(this.namespaces);
  }
}

/** The host's metric names: `app.beta.*`, never a `vault` segment (it is the packages'). */
export const HOST_BETA_METRIC_NAMES = ['app.beta.secrets.created', 'app.beta.secret_versions.created', 'app.beta.backups.runs', 'app.beta.cards.extractions'];

@Injectable()
export class HostBetaMetrics implements VaultMetricsPort {
  readonly counts = new Map<string, number>();
  private add(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
  secretCreated(): void {
    this.add('app.beta.secrets.created');
  }
  secretVersionCreated(): void {
    this.add('app.beta.secret_versions.created');
  }
  backupFinished(): void {
    this.add('app.beta.backups.runs');
  }
  cardExtracted(): void {
    this.add('app.beta.cards.extractions');
  }
}

// -----------------------------------------------------------------------------
// No AI in this host
// -----------------------------------------------------------------------------

const AI_OFF = () => new ForbiddenException({ message: 'AI is not available in Host Beta', details: { reason: 'AI_DISABLED' } });

export const hostBetaAi: VaultAiPort = {
  forUser: () => {
    throw AI_OFF();
  },
};
export const hostBetaAiConfig: VaultAiConfigPort = {
  describePublic: async () => ({ enabled: false, providers: [], keyPolicy: 'byok_with_org_fallback' }) as never,
};
export const hostBetaAiKeyPresence: VaultAiKeyPresencePort = { isConfigured: async () => false };

/**
 * The card-scan route carries the platform's `AiEnabledGuard`, which injects `AiConfigService`. A
 * host without the platform AI slice provides a stand-in that always refuses (403 AI_DISABLED).
 */
@Global()
@Module({
  providers: [
    {
      provide: AiConfigService,
      useValue: {
        assertEnabled: async () => {
          throw AI_OFF();
        },
        describePublic: hostBetaAiConfig.describePublic,
      },
    },
  ],
  exports: [AiConfigService],
})
export class HostBetaNoAiModule {}

// -----------------------------------------------------------------------------
// The module that holds the adapters
// -----------------------------------------------------------------------------

/** `VAULT_HOST`. */
export const hostBetaHostConfig: VaultHostConfig = { appUrl: HOST_APP_URL };

@Module({
  providers: [HostBetaObjectStore, HostBetaObjects, HostBetaJobs, HostBetaNotifier, HostBetaAudit, HostBetaVaultSettings, HostBetaMetrics],
  exports: [HostBetaObjectStore, HostBetaObjects, HostBetaJobs, HostBetaNotifier, HostBetaAudit, HostBetaVaultSettings, HostBetaMetrics],
})
export class HostBetaVaultAdaptersModule {}
