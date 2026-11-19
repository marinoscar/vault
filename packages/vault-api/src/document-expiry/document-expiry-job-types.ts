/**
 * Job type of the daily identity-document expiry scan (IDOC-9). PERMANENT once a row of the type
 * exists (`apps/api/test/jobs/job-type-snapshot.spec.ts` pins it); a rename is a new type.
 *
 * SERVER-ONLY on purpose: the handler decrypts Passport and ID Document versions with
 * `VAULT_ENCRYPTION_KEY`, so it implements neither `nodeResultSchema` nor `persistNodeResult` and
 * never runs on a worker node.
 */
export const DOCUMENT_EXPIRY_SCAN_JOB_TYPE = 'vault.documents.expiry_scan';

/** A scan reads every document once; one retry covers a transient database error. */
export const DOCUMENT_EXPIRY_SCAN_PROFILE = { maxRuntimeMs: 15 * 60_000, maxAttempts: 2 } as const;

/**
 * Audit action recorded per (document, expiry, threshold) once its notification was raised, meta
 * `{ threshold, expiry }`. This IS the dedup record.
 */
export const DOCUMENT_EXPIRY_NOTIFIED_AUDIT_ACTION = 'vault.document.expiry_notified';
