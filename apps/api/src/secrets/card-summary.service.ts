import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { normalizeExpMonth, normalizeExpYear } from '../ai/card-normalizer';
import { CardSummaryQueryDto } from './dto/card-summary-query.dto';

/** One card in the summary. Nothing else about a card ever leaves this service. */
export interface CardSummary {
  id: string;
  name: string;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  updatedAt: Date;
}

/** Last four digits of a card number, tolerant of spaces and dashes; null if fewer than 4 digits. */
export function extractLast4(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function toIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduce a decrypted card record to the summary fields. Only `number` (to its
 * last four digits), `exp_month` and `exp_year` are read; the CVV and every
 * other field are never touched.
 */
export function summarizeCardData(
  data: Record<string, unknown> | null,
): Pick<CardSummary, 'last4' | 'expMonth' | 'expYear'> {
  if (!data || typeof data !== 'object') {
    return { last4: null, expMonth: null, expYear: null };
  }
  const str = (v: unknown): string | null =>
    typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  return {
    last4: extractLast4(str(data.number)),
    expMonth: toIntOrNull(normalizeExpMonth(str(data.exp_month))),
    expYear: toIntOrNull(normalizeExpYear(str(data.exp_year))),
  };
}

/** Sort key: year*12+month; unknown expiry sorts last. A known year with unknown month sorts as month 1. */
function expiryKey(c: CardSummary): number {
  if (c.expYear === null) return Number.POSITIVE_INFINITY;
  return c.expYear * 12 + (c.expMonth ?? 1);
}

@Injectable()
export class CardSummaryService {
  private readonly logger = new Logger(CardSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Summaries of the caller's card secrets, decrypted server-side in one pass,
   * sorted by expiry (soonest first, unknown last) and paginated. Ownership
   * follows the secrets list: own secrets unless the caller holds
   * `secrets:read_any`.
   */
  async list(
    query: CardSummaryQueryDto,
    userId: string,
    userPermissions: string[],
  ) {
    const { page, pageSize } = query;
    const canReadAny = userPermissions.includes(PERMISSIONS.SECRETS_READ_ANY);

    const rows = await this.prisma.secret.findMany({
      where: {
        ...(canReadAny ? {} : { createdById: userId }),
        type: { isSystem: true, name: 'Card' },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        versions: {
          where: { isCurrent: true },
          select: { encryptedData: true, iv: true, authTag: true },
          take: 1,
        },
      },
    });

    const all: CardSummary[] = rows.map((row) => {
      let fields: ReturnType<typeof summarizeCardData> = {
        last4: null,
        expMonth: null,
        expYear: null,
      };
      const version = row.versions[0];
      if (version) {
        try {
          const plaintext = this.crypto.decrypt(
            version.encryptedData,
            version.iv,
            version.authTag,
          );
          fields = summarizeCardData(JSON.parse(plaintext));
        } catch {
          // One unreadable row must not fail the list. Log the id only.
          this.logger.warn(`Card summary: could not read current version of secret ${row.id}`);
        }
      }
      return { id: row.id, name: row.name, updatedAt: row.updatedAt, ...fields };
    });

    all.sort((a, b) => {
      const ka = expiryKey(a);
      const kb = expiryKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });

    const totalItems = all.length;
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }
}
