import { Global, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildDatabaseUrl, orgScopeExtension, runInOrg } from '@marinoscar/platform-api/core';

// The host's OWN client, generated from its composed schema (platform + vault-db + host.beta) into
// ../generated/client by `prisma generate --generator hostbeta`. Not `@prisma/client`, which is
// Vault's generated client in this repository.
import { PrismaClient } from '../generated/client';

/**
 * Host Beta's one Prisma client, connected as the ORDINARY application role (NOSUPERUSER
 * NOBYPASSRLS), so row-level security applies. Bound to `PLATFORM_PRISMA` and to `VAULT_PRISMA`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(buildDatabaseUrl(process.env)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** The platform slices' org-scoped client (`PLATFORM_PRISMA.forOrg`). */
  forOrg(orgId: string, opts: { userId?: string } = {}) {
    return this.$extends(orgScopeExtension(this as never, { orgId, ...opts }));
  }

  /** One transaction in an organization's row-level-security scope. */
  runInOrg<R>(orgId: string, fn: (tx: unknown) => Promise<R>, opts: { userId?: string } = {}): Promise<R> {
    return runInOrg(this as never, { orgId, ...opts }, fn as (tx: unknown) => Promise<R>);
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
