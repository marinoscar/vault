/**
 * Job type of the daily card expiry scan (E7.2, #86). PERMANENT once a row of the type exists
 * (`test/jobs/job-type-snapshot.spec.ts` pins it); a rename is a new type.
 *
 * SERVER-ONLY on purpose: the handler decrypts card versions with `VAULT_ENCRYPTION_KEY`, so it
 * implements neither `nodeResultSchema` nor `persistNodeResult` and never runs on a worker node.
 */
export const CARD_EXPIRY_SCAN_JOB_TYPE = 'vault.cards.expiry_scan';

/** A scan reads every card once; one retry covers a transient database error. */
export const CARD_EXPIRY_SCAN_PROFILE = { maxRuntimeMs: 15 * 60_000, maxAttempts: 2 } as const;

/** Audit action recorded per (card, expiry, threshold) once its notification was raised. This IS the dedup record. */
export const CARD_EXPIRY_NOTIFIED_AUDIT_ACTION = 'vault.card.expiry_notified';
