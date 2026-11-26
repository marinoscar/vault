import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_ACCESS_TOGGLE_AUDIT_ACTION,
  AGENT_AUDIT_ACTIONS,
  CARD_GRANT_AUDIT_ACTIONS,
  type AgentActivityAction,
  type AgentActivityCredentialKind,
  type AgentActivityItem,
  type AgentActivityQuery,
} from '@marinoscar/vault-contract/agent';

import { VAULT_PRISMA, type VaultPrismaClient } from '../ports';

/** Audit action names of each activity action (`card_grant` folds the owner's four grant decisions). */
const AUDIT_ACTIONS: Record<AgentActivityAction, readonly string[]> = {
  lookup: [AGENT_AUDIT_ACTIONS.LOOKUP],
  fill: [AGENT_AUDIT_ACTIONS.FILL],
  totp: [AGENT_AUDIT_ACTIONS.TOTP],
  create: [AGENT_AUDIT_ACTIONS.CREATE],
  rotate: [AGENT_AUDIT_ACTIONS.ROTATE],
  agent_access: [AGENT_ACCESS_TOGGLE_AUDIT_ACTION],
  card_lookup: [AGENT_AUDIT_ACTIONS.CARD_LOOKUP],
  card_fill: [AGENT_AUDIT_ACTIONS.CARD_FILL],
  card_grant_request: [AGENT_AUDIT_ACTIONS.CARD_GRANT_REQUEST],
  identity_lookup: [AGENT_AUDIT_ACTIONS.IDENTITY_LOOKUP],
  identity_fill: [AGENT_AUDIT_ACTIONS.IDENTITY_FILL],
  card_grant: Object.values(CARD_GRANT_AUDIT_ACTIONS),
  service_key: [AGENT_AUDIT_ACTIONS.SERVICE_KEY_READ],
};
const ACTION_OF = new Map<string, AgentActivityAction>(
  (Object.entries(AUDIT_ACTIONS) as Array<[AgentActivityAction, readonly string[]]>).flatMap(([action, audits]) =>
    audits.map((audit) => [audit, action] as [string, AgentActivityAction]),
  ),
);
const ALL_AUDIT_ACTIONS = Object.values(AUDIT_ACTIONS).flat();

/** The field an owner's grant decision shows: what happened to the grant. */
const GRANT_DECISION: Record<string, string> = {
  [CARD_GRANT_AUDIT_ACTIONS.CREATE]: 'created',
  [CARD_GRANT_AUDIT_ACTIONS.REVOKE]: 'revoked',
  [CARD_GRANT_AUDIT_ACTIONS.APPROVE]: 'approved',
  [CARD_GRANT_AUDIT_ACTIONS.DECLINE]: 'declined',
};

/** The actions the owner takes in Vault with a browser session. */
const OWNER_ACTIONS: ReadonlySet<AgentActivityAction> = new Set(['agent_access', 'card_grant']);

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * The owner's agent trail (`GET /api/agent-activity`, E14.7): the caller's own `audit_events` rows of
 * the agent actions and of the agent-access toggle, newest first, with the secret's current name and
 * the OAuth client's registered name. The query is anchored on `actor_user_id` (indexed) and the
 * action; a secret filter uses `target_type`/`target_id` (indexed); only the client filter reads a
 * JSON path, over the caller's own rows. A row is projected field by field: nothing outside the
 * documented shape (and never a value, a code or a seed, which no audit row holds) is returned.
 *
 * @stability experimental
 */
@Injectable()
export class AgentActivityService {
  constructor(@Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient) {}

  async list(
    userId: string,
    query: AgentActivityQuery,
  ): Promise<{ data: AgentActivityItem[]; meta: { page: number; pageSize: number; total: number } }> {
    const { page, pageSize } = query;
    const createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
    const where = {
      actorUserId: userId,
      action: { in: query.action ? [...AUDIT_ACTIONS[query.action]] : ALL_AUDIT_ACTIONS },
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(query.secretId ? { targetType: 'secret', targetId: query.secretId } : {}),
      ...(query.clientId ? { meta: { path: ['clientId'], equals: query.clientId } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, createdAt: true, action: true, targetId: true, meta: true },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    const metaOf = (row: { meta: unknown }): Record<string, unknown> =>
      row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? (row.meta as Record<string, unknown>) : {};

    const secretIds = [...new Set(rows.map((row) => str(metaOf(row).secretId)).filter((id): id is string => id !== null))];
    const clientIds = [...new Set(rows.map((row) => str(metaOf(row).clientId)).filter((id): id is string => id !== null))];
    const [secrets, clients] = await Promise.all([
      secretIds.length > 0
        ? this.prisma.secret.findMany({ where: { id: { in: secretIds }, createdById: userId }, select: { id: true, name: true } })
        : [],
      clientIds.length > 0
        ? this.prisma.oAuthClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const secretNames = new Map(secrets.map((secret) => [secret.id, secret.name]));
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));

    const data = rows.flatMap((row): AgentActivityItem[] => {
      const action = ACTION_OF.get(row.action);
      if (!action) return [];
      const meta = metaOf(row);
      const owner = OWNER_ACTIONS.has(action);
      const secretId = str(meta.secretId) ?? (owner ? row.targetId : null);
      const clientId = str(meta.clientId);
      const kind = meta.credential;
      const credentialKind: AgentActivityCredentialKind | null = owner
        ? 'session'
        : kind === 'oauth' || kind === 'pat' || kind === 'embedded'
          ? kind
          : null;
      const field =
        action === 'agent_access' ? str(meta.to) : action === 'card_grant' ? (GRANT_DECISION[row.action] ?? null) : str(meta.field);
      const result = typeof meta.result === 'string' ? meta.result : 'ok';
      const denied = result.startsWith('denied');
      const reason = denied ? result.split(':')[1] || 'denied' : undefined;
      return [
        {
          id: row.id,
          at: row.createdAt.toISOString(),
          action,
          result: denied ? 'denied' : 'ok',
          ...(reason !== undefined ? { reason } : {}),
          secretId,
          secretName: secretId ? (secretNames.get(secretId) ?? null) : null,
          // The toggle: the new access level (`fill` or `none`); a grant decision: created, revoked,
          // approved or declined; otherwise the field asked for.
          field,
          origin: str(meta.origin),
          purpose: str(meta.purpose),
          credentialKind,
          clientId,
          clientName: clientId ? (clientNames.get(clientId) ?? null) : kind === 'embedded' ? str(meta.clientLabel) : null,
          amount: str(meta.amount),
          currency: str(meta.currency),
          ...(action === 'service_key' ? { service: str(meta.service), keyName: str(meta.keyName) } : {}),
        },
      ];
    });

    return { data, meta: { page, pageSize, total } };
  }
}
