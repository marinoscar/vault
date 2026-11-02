import { Injectable } from '@nestjs/common';
import type { VaultAuditEvent, VaultAuditPort } from '@marinoscar/vault-api/ports';

import { PrismaService } from '../../prisma/prisma.service';

/** The package's `VAULT_AUDIT` over Vault's `audit_events` table (one insert per record). */
@Injectable()
export class VaultAuditAdapter implements VaultAuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: VaultAuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        ...(event.actorUserId !== undefined ? { actorUserId: event.actorUserId } : {}),
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.meta !== undefined ? { meta: event.meta as never } : {}),
      },
    });
  }
}
