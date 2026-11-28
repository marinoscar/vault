import { NotFoundException } from '@nestjs/common';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';
import { normalizeOrigin } from '@marinoscar/vault-contract/secrets';

import { InMemoryAgentRateLimiter } from '../agent/agent-rate-limiter';
import { McpDispatcher, type McpCaller } from '../mcp/mcp-dispatcher';
import { McpSecretsService } from '../mcp/mcp-secrets.service';
import { VaultMcpToolsBootstrap } from '../mcp/vault-mcp-tools';
import { McpToolRegistry } from '../mcp/protocol/mcp-tool';
import type { SecretsService } from '../secrets/secrets.service';
import { InMemoryAudit } from './fake-audit';
import { FakeSettings } from './fake-ports';
import type { VaultPrismaClient } from '../ports';

/** A password no response may ever contain. */
export const MCP_CANARY_PASSWORD = 'CanaryPw-7Qz9-do-not-leak';
/** A TOTP seed no response may ever contain. */
export const MCP_CANARY_TOTP = 'JBSWY3DPEHPK3PXP';
/** A username that IS allowed in a response (non-sensitive). */
export const MCP_CANARY_USERNAME = 'person-a@example.test';

interface Row {
  id: string;
  name: string;
  createdById: string;
  agentAccess: 'none' | 'fill';
  assistantReveal: boolean;
  origins: string[];
  updatedAt: Date;
  type: { id: string; name: string; isSystem: boolean; description: string; fields: unknown };
  versions: Array<{ version: number }>;
  values: Record<string, unknown>;
}

export interface McpHarnessOptions {
  enabled?: boolean;
  ratePerMinute?: number;
  revealPerMinute?: number;
}

/**
 * In-memory secrets, secret types, settings and audit behind the real `McpSecretsService`,
 * `McpDispatcher` and the six tools. For specs: no database, no Nest container.
 *
 * @stability experimental
 */
export function buildMcpHarness(options: McpHarnessOptions = {}) {
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const types = SYSTEM_SECRET_TYPES.map((t) => ({ id: uuid(), name: t.name, isSystem: true, description: t.description, fields: t.fields }));
  const typeNamed = (name: string) => types.find((t) => t.name === name)!;
  const rows: Row[] = [];
  const state = { updates: 0 };

  const matches = (row: Row, where: Record<string, any>): boolean => {
    if (where.id?.in && !where.id.in.includes(row.id)) return false;
    if (typeof where.id === 'string' && where.id !== row.id) return false;
    if (where.createdById && where.createdById !== row.createdById) return false;
    if (where.agentAccess && where.agentAccess !== row.agentAccess) return false;
    if (where.assistantReveal !== undefined && where.assistantReveal !== row.assistantReveal) return false;
    if (Array.isArray(where.OR) && !where.OR.some((w: Record<string, any>) => matches(row, w))) return false;
    if (typeof where.type?.name === 'string' && where.type.name !== row.type.name) return false;
    if (where.type?.name?.equals && String(where.type.name.equals).toLowerCase() !== row.type.name.toLowerCase()) return false;
    if (where.name?.contains && !row.name.toLowerCase().includes(String(where.name.contains).toLowerCase())) return false;
    return true;
  };

  const prisma = {
    secret: {
      findMany: async ({ where, take }: { where: Record<string, any>; take?: number }) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, take),
      findFirst: async ({ where }: { where: Record<string, any> }) => rows.find((r) => matches(r, where)) ?? null,
    },
    secretType: {
      findMany: async () => [...types].sort((a, b) => a.name.localeCompare(b.name)),
      findFirst: async ({ where }: { where: { name: { equals: string } } }) =>
        types.find((t) => t.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
    },
  } as unknown as VaultPrismaClient;

  const secrets = {
    readCurrentValues: async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundException('Secret not found');
      return { ...row.values };
    },
    findCredentialsByOrigin: async (userId: string, origin: string) => {
      const want = normalizeOrigin(origin);
      return rows
        .filter((r) => r.createdById === userId && r.agentAccess === 'fill' && r.origins.includes(want ?? ''))
        .map((r) => ({ id: r.id, name: r.name, username: null, origins: r.origins, matchKind: 'exact' as const }));
    },
    createAgentCredential: async (userId: string, input: { name: string; values: Record<string, unknown> }) => {
      const row = add({ userId, type: 'Credential', name: input.name, values: input.values, agentAccess: 'fill' });
      return { id: row.id, name: row.name, origins: row.origins };
    },
    create: async (dto: { typeId: string; name: string; data: Record<string, unknown> }, userId: string) => {
      const type = types.find((t) => t.id === dto.typeId)!;
      const row = add({ userId, type: type.name, name: dto.name, values: dto.data, agentAccess: 'none' });
      // The real service returns the decrypted values too: the MCP layer must not forward them.
      return { id: row.id, name: row.name, origins: row.origins, values: dto.data };
    },
    update: async (id: string, dto: { data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === id)!;
      row.values = dto.data;
      row.versions = [{ version: (row.versions[0]?.version ?? 0) + 1 }];
      state.updates += 1;
      return { id, currentVersion: row.versions[0]!.version, values: dto.data };
    },
  } as unknown as SecretsService;

  /** Adds a secret directly (a fixture). */
  function add(input: { userId: string; type: string; name: string; values: Record<string, unknown>; agentAccess?: 'none' | 'fill'; assistantReveal?: boolean }): Row {
    const type = typeNamed(input.type);
    const url = typeof input.values.url === 'string' ? normalizeOrigin(input.values.url) : null;
    const row: Row = {
      id: uuid(),
      name: input.name,
      createdById: input.userId,
      agentAccess: input.agentAccess ?? 'none',
      assistantReveal: input.assistantReveal ?? false,
      origins: url ? [url] : [],
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      type,
      versions: [{ version: 1 }],
      values: { ...input.values },
    };
    rows.push(row);
    return row;
  }

  const settings = new FakeSettings({ agentAccess: { enabled: options.enabled ?? true, ...(options.revealPerMinute ? { revealPerMinute: options.revealPerMinute } : {}) } });
  const audit = new InMemoryAudit();
  const limiter = new InMemoryAgentRateLimiter();
  const registry = new McpToolRegistry();
  const service = new McpSecretsService(prisma, secrets);
  new VaultMcpToolsBootstrap(registry, service).onModuleInit();
  const dispatcher = new McpDispatcher(registry, limiter, settings, audit, options.ratePerMinute ? { ratePerMinute: options.ratePerMinute } : undefined);

  /** A caller; `authorize` can be overridden to simulate a step-up. */
  const caller = (over: Partial<McpCaller> = {}): McpCaller => ({
    userId: 'user-aaa',
    permissions: ['secrets:read', 'secrets:write'],
    credential: { kind: 'oauth', tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resourceId: 'mcp', scopes: ['vault:mcp_read', 'vault:mcp_write', 'vault:mcp_reveal'] } as never,
    authorize: () => undefined,
    ...over,
  });

  return { prisma, secrets, rows, types, add, settings, audit, limiter, registry, service, dispatcher, caller, state };
}
