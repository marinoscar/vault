/**
 * Job type of the one-off `secrets.origins` backfill (E14.4, #176). PERMANENT once a row of the
 * type exists (`test/jobs/job-type-snapshot.spec.ts` pins it); a rename is a new type.
 *
 * SERVER-ONLY on purpose: the handler decrypts Credential versions with `VAULT_ENCRYPTION_KEY`, so
 * it implements neither `nodeResultSchema` nor `persistNodeResult` and never runs on a worker node.
 */
export const SECRETS_ORIGINS_BACKFILL_JOB_TYPE = 'vault.secrets.origins.backfill';

/** One pass over every Credential; one retry covers a transient database error. */
export const SECRETS_ORIGINS_BACKFILL_PROFILE = { maxRuntimeMs: 15 * 60_000, maxAttempts: 2 } as const;

/** Audit action recorded when a backfill finished; its presence stops the boot check from queueing another. */
export const SECRETS_ORIGINS_BACKFILLED_AUDIT_ACTION = 'vault.secrets.origins_backfilled';
