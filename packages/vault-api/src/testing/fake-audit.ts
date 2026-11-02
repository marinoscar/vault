import type { VaultAuditEvent, VaultAuditPort, VaultPrismaClient } from '../ports';

/**
 * An audit port that records to an array, for specs and conformance runs.
 *
 * @stability experimental
 */
export class InMemoryAudit implements VaultAuditPort {
  readonly events: VaultAuditEvent[] = [];

  async record(event: VaultAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * An audit port over a (mocked) Prisma client's `auditEvent.create`: the row shape the host adapter
 * writes, so a spec can assert on the table write it always asserted on.
 *
 * @stability experimental
 */
export function auditOverPrisma(prisma: unknown): VaultAuditPort {
  const client = prisma as Pick<VaultPrismaClient, 'auditEvent'>;
  return {
    async record(event: VaultAuditEvent): Promise<void> {
      await client.auditEvent.create({
        data: {
          ...(event.actorUserId !== undefined ? { actorUserId: event.actorUserId } : {}),
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          ...(event.meta !== undefined ? { meta: event.meta as never } : {}),
        },
      });
    },
  };
}
