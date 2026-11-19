import { Injectable, Logger, Inject } from '@nestjs/common';

import {
  EXPIRING_DOCUMENT_TYPE_NAMES,
  documentExpiryLeadDays,
  documentExpiryStatus,
  isExpiringDocumentTypeName,
  parseDocumentDate,
  type DocumentSummaryItem,
  type DocumentSummaryResponse,
} from '@marinoscar/vault-contract/secrets';
import { isIdDocumentKind } from '@marinoscar/vault-contract/secret-types';

import { VAULT_CRYPTO, VAULT_PRISMA, type VaultCryptoPort, type VaultPrismaClient } from '../ports';

/**
 * Reduce a decrypted Passport or ID Document record to the two facts the summary shows: the kind
 * (catalog text only; a value outside the catalog reads as `null`) and the expiry date. Nothing else
 * is read: never the number, the date of birth or the holder name.
 */
export function summarizeDocumentData(
  typeName: string,
  data: Record<string, unknown> | null,
): Pick<DocumentSummaryItem, 'documentKind' | 'expiryDate'> {
  if (!data || typeof data !== 'object') return { documentKind: null, expiryDate: null };
  const kind = data.document_kind;
  return {
    documentKind: typeName === 'ID Document' && isIdDocumentKind(kind) ? kind : null,
    expiryDate: parseDocumentDate(data.expiry_date),
  };
}

/** Sort key: the expiry date; no expiry sorts last. */
const sortKey = (item: DocumentSummaryItem): string => item.expiryDate ?? '9999-99-99';

/**
 * `GET /api/secrets/documents/summary` (IDOC-9): the caller's OWN Passport and ID Document secrets
 * with their expiry status. Decrypted server-side; only the kind and the expiry date are read.
 * Unlike the card summary, `secrets:read_any` does not widen it: the Home panel and the reminders
 * are about the caller's own documents.
 */
@Injectable()
export class DocumentSummaryService {
  private readonly logger = new Logger(DocumentSummaryService.name);

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
  ) {}

  async list(userId: string, now: Date = new Date()): Promise<DocumentSummaryResponse> {
    const rows = await this.prisma.secret.findMany({
      where: {
        createdById: userId,
        type: { isSystem: true, name: { in: [...EXPIRING_DOCUMENT_TYPE_NAMES] } },
      },
      select: {
        id: true,
        name: true,
        type: { select: { name: true } },
        versions: {
          where: { isCurrent: true },
          select: { encryptedData: true, iv: true, authTag: true },
          take: 1,
        },
      },
    });

    const items: DocumentSummaryItem[] = [];
    for (const row of rows) {
      const typeName = row.type?.name;
      if (!isExpiringDocumentTypeName(typeName)) continue;
      let facts: Pick<DocumentSummaryItem, 'documentKind' | 'expiryDate'> = { documentKind: null, expiryDate: null };
      const version = row.versions[0];
      if (version) {
        try {
          facts = summarizeDocumentData(
            typeName,
            JSON.parse(this.crypto.decrypt(version.encryptedData, version.iv, version.authTag)),
          );
        } catch {
          // One unreadable row must not fail the list. Log the id only.
          this.logger.warn(`Document summary: could not read current version of secret ${row.id}`);
        }
      }
      items.push({
        id: row.id,
        name: row.name,
        typeName,
        ...facts,
        status: documentExpiryStatus(facts.expiryDate, documentExpiryLeadDays(typeName, facts.documentKind), now),
      });
    }

    items.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    return { items };
  }
}
