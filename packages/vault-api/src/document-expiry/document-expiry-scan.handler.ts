import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';

import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';
import { EXPIRING_DOCUMENT_TYPE_NAMES } from '@marinoscar/vault-contract/secrets';
import { isIdDocumentKind } from '@marinoscar/vault-contract/secret-types';

import {
  VAULT_DOCUMENT_EXPIRING_EVENT,
  type VaultDocumentExpiringNotificationData,
} from '../core/notification-data';
import {
  DOCUMENT_EXPIRY_NOTIFIED_AUDIT_ACTION,
  DOCUMENT_EXPIRY_SCAN_JOB_TYPE,
  DOCUMENT_EXPIRY_SCAN_PROFILE,
} from './document-expiry-job-types';
import { daysUntilDate, dueThreshold, leadDaysFor, parseDocumentDate } from './document-expiry';
import {
  hostAppUrl,
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_HOST,
  VAULT_JOBS,
  VAULT_NOTIFY,
  VAULT_PRISMA,
  type VaultAuditPort,
  type VaultCryptoPort,
  type VaultHostConfig,
  type VaultJobsPort,
  type VaultNotifyPort,
  type VaultPrismaClient,
} from '../ports';

const BATCH_SIZE = 200;

/** What a scan did, for the log and the tests. Counts only. */
export interface DocumentExpiryScanResult {
  scanned: number;
  notified: number;
  unreadable: number;
}

/** The two facts a scan keeps from a decrypted document. */
interface DocumentExpiryFacts {
  expiry: string | null;
  documentKind: string | null;
}

/**
 * `vault.documents.expiry_scan` (IDOC-9): tells the owner of a Passport or ID Document secret that
 * it reaches one of its expiry lead days (system job, `orgId` null; enqueued daily by
 * `DocumentExpiryTask`). The lead days are the kind's (`leadDaysFor`).
 *
 * SERVER-ONLY (no `nodeResultSchema` / `persistNodeResult`): it decrypts the current version of each
 * document with `VAULT_ENCRYPTION_KEY`.
 *
 * ⚠ WHAT IT TAKES FROM A DECRYPTED DOCUMENT: `expiry_date` and `document_kind`, nothing else. The
 * decrypted object is dropped in the same method, never stored, logged or passed on; the payload has
 * no field for a number, a date of birth or a holder name. A version that cannot be decrypted is
 * counted and logged by secret id only. If EVERY document is unreadable the job fails loudly (a
 * rotated key), not silently.
 *
 * DEDUP without a new table: once a notification is raised, an audit row
 * (`vault.document.expiry_notified`, target = the secret, meta `{ threshold, expiry }`) records it,
 * and a later scan skips a (document, expiry, threshold) it finds there. Renewing the document
 * changes the expiry and so re-arms the reminders. Notify first, record second: a crash in between
 * repeats one message, never loses one.
 */
@Injectable()
export class DocumentExpiryScanHandler implements JobHandler, OnModuleInit {
  readonly type = DOCUMENT_EXPIRY_SCAN_JOB_TYPE;
  readonly label = 'Document expiry scan';
  readonly profile = DOCUMENT_EXPIRY_SCAN_PROFILE;
  private readonly logger = new Logger(DocumentExpiryScanHandler.name);

  constructor(
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
    @Inject(VAULT_NOTIFY) private readonly notifications: VaultNotifyPort,
    @Inject(VAULT_AUDIT) private readonly auditLog: VaultAuditPort,
    @Optional() @Inject(VAULT_HOST) private readonly host?: VaultHostConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.scan(new Date());
    if (result.scanned > 0 && result.unreadable === result.scanned) {
      throw new Error('No document could be read; check the encryption key');
    }
  }

  /** One pass over every Passport and ID Document. Public so a test can run it with a chosen clock. */
  async scan(now: Date): Promise<DocumentExpiryScanResult> {
    const result: DocumentExpiryScanResult = { scanned: 0, notified: 0, unreadable: 0 };
    const types = await this.prisma.secretType.findMany({
      where: { name: { in: [...EXPIRING_DOCUMENT_TYPE_NAMES] }, isSystem: true },
      select: { id: true, name: true },
    });
    if (types.length === 0) return result;
    const typeNames = new Map(types.map((type) => [type.id, type.name]));

    let cursor: string | undefined;
    for (;;) {
      const secrets = await this.prisma.secret.findMany({
        where: { typeId: { in: [...typeNames.keys()] }, createdBy: { isActive: true } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          name: true,
          typeId: true,
          createdById: true,
          versions: {
            where: { isCurrent: true },
            take: 1,
            select: { encryptedData: true, iv: true, authTag: true },
          },
        },
      });
      if (secrets.length === 0) break;
      cursor = secrets[secrets.length - 1].id;

      const notified = await this.loadNotified(secrets.map((secret) => secret.id));

      for (const secret of secrets) {
        const version = secret.versions[0];
        const typeName = typeNames.get(secret.typeId);
        if (!secret.createdById || !version || !typeName) continue;
        result.scanned += 1;

        const facts = this.readFacts(secret.id, version, result);
        if (!facts?.expiry) continue;

        const leadDays = leadDaysFor(typeName, facts.documentKind);
        if (leadDays.length === 0) continue;
        const daysLeft = daysUntilDate(facts.expiry, now);
        if (daysLeft === null) continue;

        const threshold = dueThreshold(
          daysLeft,
          leadDays,
          new Set(notified.get(secret.id)?.get(facts.expiry) ?? []),
        );
        if (threshold === null) continue;

        const data: VaultDocumentExpiringNotificationData = {
          secretId: secret.id,
          secretName: secret.name,
          // Catalog text only: a kind outside the catalog is never echoed into a message.
          documentLabel:
            typeName === 'Passport' ? 'Passport' : isIdDocumentKind(facts.documentKind) ? facts.documentKind : 'ID Document',
          expiry: facts.expiry,
          daysLeft,
          threshold,
          ...hostAppUrl(this.host),
        };
        await this.notifications.notifyNow(VAULT_DOCUMENT_EXPIRING_EVENT, secret.createdById, data);
        await this.record(secret.id, facts.expiry, threshold);
        result.notified += 1;
      }
    }

    this.logger.log(
      `Document expiry scan: ${result.scanned} document(s) read, ${result.notified} notification(s), ${result.unreadable} unreadable`,
    );
    return result;
  }

  /**
   * Decrypts the version and keeps ONLY the expiry date and the kind; the rest of the plaintext never
   * leaves this method. The kind is kept only when it is one of the catalog's (static text).
   */
  private readFacts(
    secretId: string,
    version: { encryptedData: string; iv: string; authTag: string },
    result: DocumentExpiryScanResult,
  ): DocumentExpiryFacts | null {
    try {
      const values = JSON.parse(this.crypto.decrypt(version.encryptedData, version.iv, version.authTag)) as Record<
        string,
        unknown
      >;
      const kind = values.document_kind;
      return {
        expiry: parseDocumentDate(values.expiry_date),
        documentKind: typeof kind === 'string' && kind.trim() ? kind.trim() : null,
      };
    } catch {
      result.unreadable += 1;
      this.logger.warn(`Document ${secretId}: the current version could not be read; skipped`);
      return null;
    }
  }

  /** secretId -> expiry -> thresholds already notified. */
  private async loadNotified(secretIds: string[]): Promise<Map<string, Map<string, number[]>>> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { action: DOCUMENT_EXPIRY_NOTIFIED_AUDIT_ACTION, targetType: 'secret', targetId: { in: secretIds } },
      select: { targetId: true, meta: true },
    });
    const map = new Map<string, Map<string, number[]>>();
    for (const row of rows) {
      const meta = (row.meta ?? {}) as { threshold?: unknown; expiry?: unknown };
      if (typeof meta.threshold !== 'number' || typeof meta.expiry !== 'string' || !row.targetId) continue;
      const byExpiry = map.get(row.targetId) ?? new Map<string, number[]>();
      byExpiry.set(meta.expiry, [...(byExpiry.get(meta.expiry) ?? []), meta.threshold]);
      map.set(row.targetId, byExpiry);
    }
    return map;
  }

  private async record(secretId: string, expiry: string, threshold: number): Promise<void> {
    try {
      await this.auditLog.record({
        action: DOCUMENT_EXPIRY_NOTIFIED_AUDIT_ACTION,
        targetType: 'secret',
        targetId: secretId,
        meta: { threshold, expiry },
      });
    } catch (error) {
      // The reminder went out; failing here would only make the next scan repeat it.
      this.logger.warn(`Document ${secretId}: the reminder could not be recorded: ${(error as Error)?.message}`);
    }
  }
}
