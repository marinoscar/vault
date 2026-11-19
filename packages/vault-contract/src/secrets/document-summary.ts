import { z } from 'zod';

import { ID_DOCUMENT_KIND_CATALOG, PASSPORT_EXPIRY_LEAD_DAYS, isIdDocumentKind } from '../secret-types/id-documents.js';

/**
 * Identity-document expiry (IDOC-9): the lead days of a document, its expiry
 * status and the wire shape of `GET /api/secrets/documents/summary`. Pure:
 * no I/O, no ambient clock.
 *
 * A document's `expiry_date` is a calendar date (`YYYY-MM-DD`). A document is
 * valid through that day: on the day it has 0 days left, the day after it is
 * expired. Days are counted in UTC so the server and every browser agree.
 *
 * @packageDocumentation
 */

/** The system types whose secrets carry an `expiry_date` reminder. @stability experimental */
export const EXPIRING_DOCUMENT_TYPE_NAMES = ['Passport', 'ID Document'] as const;

/** @stability experimental */
export type ExpiringDocumentTypeName = (typeof EXPIRING_DOCUMENT_TYPE_NAMES)[number];

/** Whether `typeName` is one of {@link EXPIRING_DOCUMENT_TYPE_NAMES}. @stability experimental */
export function isExpiringDocumentTypeName(typeName: unknown): typeName is ExpiringDocumentTypeName {
  return typeof typeName === 'string' && (EXPIRING_DOCUMENT_TYPE_NAMES as readonly string[]).includes(typeName);
}

/**
 * The reminder lead days of a document, descending: a `Passport` takes
 * `PASSPORT_EXPIRY_LEAD_DAYS`; an `ID Document` takes the catalog entry of its
 * `document_kind`, and a kind the catalog does not know (unset, or from an older
 * catalog) takes `Other`'s. Any other type has none. `[]` means no reminders
 * (a Social Security Card).
 *
 * @stability experimental
 */
export function documentExpiryLeadDays(typeName: unknown, documentKind: unknown): readonly number[] {
  if (typeName === 'Passport') return PASSPORT_EXPIRY_LEAD_DAYS;
  if (typeName !== 'ID Document') return [];
  return ID_DOCUMENT_KIND_CATALOG[isIdDocumentKind(documentKind) ? documentKind : 'Other'].expiryLeadDays;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses a stored `expiry_date` (`YYYY-MM-DD`, a real calendar day) into the
 * same string, or `null` for anything else (unset, `2027-02-30`, free text).
 *
 * @stability experimental
 */
export function parseDocumentDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return trimmed;
}

/**
 * Whole calendar days from `today` (its UTC date) to `isoDate`: 0 on the
 * expiry day, negative after it, `null` when `isoDate` is not a valid date.
 *
 * @stability experimental
 */
export function daysUntilDate(isoDate: string, today: Date): number | null {
  const parsed = parseDocumentDate(isoDate);
  if (!parsed || Number.isNaN(today.getTime())) return null;
  const [year, month, day] = parsed.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / DAY_MS);
}

/** The expiry status of a document. @stability experimental */
export const documentExpiryStatusSchema = z.enum(['expired', 'expiring_soon', 'valid', 'no_expiry']);

/** @stability experimental */
export type DocumentExpiryStatus = z.infer<typeof documentExpiryStatusSchema>;

/**
 * The status of a document that expires on `expiryDate`, for its lead days:
 * `no_expiry` without a valid date, `expired` after the expiry day,
 * `expiring_soon` within the largest lead day (the expiry day included), else
 * `valid`. A kind with no lead days is never `expiring_soon`.
 *
 * @stability experimental
 */
export function documentExpiryStatus(
  expiryDate: unknown,
  leadDays: readonly number[],
  today: Date,
): DocumentExpiryStatus {
  const parsed = parseDocumentDate(expiryDate);
  if (!parsed) return 'no_expiry';
  const days = daysUntilDate(parsed, today);
  if (days === null) return 'no_expiry';
  if (days < 0) return 'expired';
  const window = leadDays.length > 0 ? Math.max(...leadDays) : -1;
  return days <= window ? 'expiring_soon' : 'valid';
}

/**
 * One document of `GET /api/secrets/documents/summary`. NEVER a document
 * number, date of birth, holder name or any other field value: the kind and
 * the expiry date are the only fields read from the decrypted version.
 *
 * @stability experimental
 */
export const documentSummaryItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    typeName: z.enum(EXPIRING_DOCUMENT_TYPE_NAMES),
    /** The `document_kind` of an ID Document; `null` for a Passport or an unreadable version. */
    documentKind: z.string().nullable(),
    /** `YYYY-MM-DD`, or `null` when unset or unreadable. */
    expiryDate: z.string().nullable(),
    status: documentExpiryStatusSchema,
  })
  .strict();

/** @stability experimental */
export type DocumentSummaryItem = z.infer<typeof documentSummaryItemSchema>;

/**
 * The `data` of `GET /api/secrets/documents/summary`: the caller's own Passport
 * and ID Document secrets, soonest expiry first, no expiry last.
 *
 * @stability experimental
 */
export const documentSummaryResponseSchema = z.object({ items: z.array(documentSummaryItemSchema) });

/** @stability experimental */
export type DocumentSummaryResponse = z.infer<typeof documentSummaryResponseSchema>;
