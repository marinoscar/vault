/**
 * VAULT_AUDIT: the audit trail (`audit_events`).
 *
 * One write per call, after the audited action; the slices that must not fail because the trail
 * could not be written catch the error themselves.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_AUDIT = Symbol.for('@marinoscar/vault/VAULT_AUDIT');

/** One audit record. `meta` carries scalars and small plain objects, never secret material. */
export interface VaultAuditEvent {
  /** The acting user, or `null`/absent for a system action. */
  actorUserId?: string | null;
  /** The action name, e.g. `secrets.export`. */
  action: string;
  /** The kind of the target, e.g. `secret`, `backup_run`, `user`. */
  targetType: string;
  /** The target id. */
  targetId: string;
  /** Extra detail. */
  meta?: Record<string, unknown>;
}

/**
 * The audit port.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultAuditPort {
  /** Appends one record. */
  record(event: VaultAuditEvent): Promise<void>;
}
