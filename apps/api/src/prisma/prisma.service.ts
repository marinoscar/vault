import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from '../common/database-url';
import {
  orgScopeExtension,
  runInOrg,
  type OrgScope,
  type RlsTransactionClient,
  type RlsTransactionOptions,
} from './org-scope';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg(buildDatabaseUrl());
    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      // @ts-ignore - Prisma event typing
      this.$on('query', (e: any) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * PLATFORM-ADOPTION-SHIM(E3.1): same signature as the platform's
   * `PrismaService.forOrg`. A client whose every operation runs in a
   * transaction that first sets the transaction-local `app.org_id` (and
   * `app.user_id`), so row-level security shows it one organization's rows.
   * Good for single operations; a unit of work uses {@link runInOrg}. Never
   * use the returned client inside `$transaction(async tx => ...)`.
   */
  forOrg(orgId: string, opts: { userId?: string } = {}) {
    return this.$extends(
      orgScopeExtension(this, { orgId, ...(opts.userId !== undefined ? { userId: opts.userId } : {}) }),
    );
  }

  /**
   * PLATFORM-ADOPTION-SHIM(E3.1): same signature as the platform's
   * `PrismaService.runInOrg`. One interactive transaction scoped to an
   * organization (`set_config(..., true)` first, never a session-level `SET`);
   * `fn` receives the plain transaction client.
   */
  runInOrg<R>(
    orgId: string,
    fn: (tx: RlsTransactionClient<PrismaService>) => Promise<R>,
    options: { userId?: string } & RlsTransactionOptions = {},
  ): Promise<R> {
    const { userId, ...transaction } = options;
    const scope: OrgScope = { orgId, ...(userId !== undefined ? { userId } : {}) };
    return runInOrg(this, scope, fn, transaction);
  }

  /**
   * Clean database for testing
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase only allowed in test environment');
    }

    const tablenames = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;

    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(
          `TRUNCATE TABLE "public"."${tablename}" CASCADE;`,
        );
      }
    }
  }
}
