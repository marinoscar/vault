import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import type { Job, JobHandler } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';

import { CryptoService } from '../common/services/crypto.service';
import {
  VAULT_CARD_EXPIRING_EVENT,
  type VaultCardExpiringNotificationData,
} from '../notifications-registry/vault-notification-data';
import { PrismaService } from '../prisma/prisma.service';
import {
  CARD_EXPIRY_NOTIFIED_AUDIT_ACTION,
  CARD_EXPIRY_SCAN_JOB_TYPE,
  CARD_EXPIRY_SCAN_PROFILE,
} from './card-expiry-job-types';
import { daysUntilExpiry, dueThreshold, formatCardExpiry, parseCardExpiry } from './card-expiry';

const BATCH_SIZE = 200;

/** What a scan did, for the log and the tests. Counts only. */
export interface CardExpiryScanResult {
  scanned: number;
  notified: number;
  unreadable: number;
}

/**
 * `vault.cards.expiry_scan`: tells the owner of a card secret that it expires in 30 days, 7 days,
 * or at the end of its expiry month (system job, `orgId` null; enqueued daily by `CardExpiryTask`).
 *
 * SERVER-ONLY (no `nodeResultSchema` / `persistNodeResult`): it decrypts the current version of each
 * card with `VAULT_ENCRYPTION_KEY`.
 *
 * ⚠ WHAT IT TAKES FROM A DECRYPTED CARD: `exp_month` and `exp_year`, nothing else. The decrypted
 * object is dropped in the same expression, never stored, logged or passed on; the notification
 * payload has no field for a number or a CVV. A version that cannot be decrypted is counted and logged
 * by secret id only. If EVERY card is unreadable the job fails loudly (a rotated key), not silently.
 *
 * DEDUP without a new table: once a notification is raised, an audit row
 * (`vault.card.expiry_notified`, target = the secret, meta `{ threshold, expiry }`) records it, and a
 * later scan skips a (card, expiry, threshold) it finds there. Renewing the card changes the expiry and
 * so re-arms the reminders. Notify first, record second: a crash in between repeats one message, never
 * loses one. Retention of `audit_events` is OFF by default; a deployment that enables it with fewer than
 * 31 days would re-send a reminder.
 */
@Injectable()
export class CardExpiryScanHandler implements JobHandler, OnModuleInit {
  readonly type = CARD_EXPIRY_SCAN_JOB_TYPE;
  readonly label = 'Card expiry scan';
  readonly profile = CARD_EXPIRY_SCAN_PROFILE;
  private readonly logger = new Logger(CardExpiryScanHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.scan(new Date());
    if (result.scanned > 0 && result.unreadable === result.scanned) {
      throw new Error('No card could be read; check the encryption key');
    }
  }

  /** One pass over every card. Public so the integration test can run it twice with a chosen clock. */
  async scan(now: Date): Promise<CardExpiryScanResult> {
    const result: CardExpiryScanResult = { scanned: 0, notified: 0, unreadable: 0 };
    const cardType = await this.prisma.secretType.findFirst({
      where: { name: 'Card', isSystem: true },
      select: { id: true },
    });
    if (!cardType) return result;

    let cursor: string | undefined;
    for (;;) {
      const secrets = await this.prisma.secret.findMany({
        where: { typeId: cardType.id, createdBy: { isActive: true } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          name: true,
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
        if (!secret.createdById || !version) continue;
        result.scanned += 1;

        const expiry = this.readExpiry(secret.id, version, result);
        if (!expiry) continue;

        const label = formatCardExpiry(expiry);
        const threshold = dueThreshold(
          daysUntilExpiry(expiry, now),
          new Set(notified.get(secret.id)?.get(label) ?? []),
        );
        if (threshold === null) continue;

        const data: VaultCardExpiringNotificationData = {
          secretId: secret.id,
          secretName: secret.name,
          expiry: label,
          threshold,
          ...(process.env.APP_URL ? { appUrl: process.env.APP_URL } : {}),
        };
        await this.notifications.notifyNow(VAULT_CARD_EXPIRING_EVENT, secret.createdById, data);
        await this.record(secret.id, label, threshold);
        result.notified += 1;
      }
    }

    this.logger.log(
      `Card expiry scan: ${result.scanned} card(s) read, ${result.notified} notification(s), ${result.unreadable} unreadable`,
    );
    return result;
  }

  /** Decrypts the version and keeps ONLY the expiry; the rest of the plaintext never leaves this method. */
  private readExpiry(
    secretId: string,
    version: { encryptedData: string; iv: string; authTag: string },
    result: CardExpiryScanResult,
  ) {
    try {
      const values = JSON.parse(this.crypto.decrypt(version.encryptedData, version.iv, version.authTag)) as Record<
        string,
        unknown
      >;
      return parseCardExpiry(values.exp_month, values.exp_year);
    } catch {
      result.unreadable += 1;
      this.logger.warn(`Card ${secretId}: the current version could not be read; skipped`);
      return null;
    }
  }

  /** secretId -> expiry label -> thresholds already notified. */
  private async loadNotified(secretIds: string[]): Promise<Map<string, Map<string, number[]>>> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { action: CARD_EXPIRY_NOTIFIED_AUDIT_ACTION, targetType: 'secret', targetId: { in: secretIds } },
      select: { targetId: true, meta: true },
    });
    const map = new Map<string, Map<string, number[]>>();
    for (const row of rows) {
      const meta = (row.meta ?? {}) as { threshold?: unknown; expiry?: unknown };
      if (typeof meta.threshold !== 'number' || typeof meta.expiry !== 'string') continue;
      const byExpiry = map.get(row.targetId) ?? new Map<string, number[]>();
      byExpiry.set(meta.expiry, [...(byExpiry.get(meta.expiry) ?? []), meta.threshold]);
      map.set(row.targetId, byExpiry);
    }
    return map;
  }

  private async record(secretId: string, expiry: string, threshold: number): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          action: CARD_EXPIRY_NOTIFIED_AUDIT_ACTION,
          targetType: 'secret',
          targetId: secretId,
          meta: { threshold, expiry },
        },
      });
    } catch (error) {
      // The reminder went out; failing here would only make the next scan repeat it.
      this.logger.warn(`Card ${secretId}: the reminder could not be recorded: ${(error as Error)?.message}`);
    }
  }
}
