import { api } from '../../core/headless/http.js';

/** What an agent did: the audit actions of the agent API (logins, cards, identity) and the owner's decisions. */
export type AgentActivityAction =
  | 'lookup'
  | 'fill'
  | 'totp'
  | 'create'
  | 'rotate'
  | 'agent_access'
  | 'card_lookup'
  | 'card_fill'
  | 'card_grant_request'
  | 'identity_lookup'
  | 'identity_fill'
  | 'card_grant';

/** The credential an agent call authenticated with (`embedded`: a host that embeds Vault, by its label). */
export type AgentCredentialKind = 'oauth' | 'pat' | 'session' | 'embedded';

/**
 * One row of `GET /api/agent-activity`. Never carries a value, code or seed: only who, what, where and why.
 * (The contract type moves to `@marinoscar/vault-contract/agent` later; this is the same shape.)
 */
export interface AgentActivityItem {
  id: string;
  /** ISO timestamp. */
  at: string;
  action: AgentActivityAction;
  result: 'ok' | 'denied';
  /** The denial reason when `result` is `denied`. */
  reason?: string;
  secretId: string | null;
  secretName: string | null;
  /** The field name touched (never its value). */
  field: string | null;
  /** The website the agent was acting on. */
  origin: string | null;
  /** The agent's stated purpose. */
  purpose: string | null;
  credentialKind: AgentCredentialKind | null;
  clientId: string | null;
  clientName: string | null;
  /** A card call's stated amount (`"42.50"`); absent otherwise. */
  amount?: string | null;
  /** A card call's currency. */
  currency?: string | null;
}

export const AGENT_ACTIVITY_ACTIONS: readonly AgentActivityAction[] = [
  'lookup',
  'fill',
  'totp',
  'create',
  'rotate',
  'agent_access',
  'card_lookup',
  'card_fill',
  'card_grant_request',
  'identity_lookup',
  'identity_fill',
  'card_grant',
];

export const AGENT_ACTION_LABELS: Record<AgentActivityAction, string> = {
  lookup: 'Looked up',
  fill: 'Filled',
  totp: 'One-time code',
  create: 'Created',
  rotate: 'Rotated',
  agent_access: 'Access changed',
  card_lookup: 'Cards looked up',
  card_fill: 'Card filled',
  card_grant_request: 'Asked for a shop',
  identity_lookup: 'Identity looked up',
  identity_fill: 'Identity filled',
  card_grant: 'Shop permission',
};

export interface AgentActivityQuery {
  /** 1-based. */
  page?: number;
  pageSize?: number;
  action?: AgentActivityAction;
  secretId?: string;
  clientId?: string;
  /** ISO. */
  from?: string;
  /** ISO. */
  to?: string;
}

export interface AgentActivityPage {
  items: AgentActivityItem[];
  total: number;
}

/** The name shown for the app behind a row. */
export function agentAppLabel(item: Pick<AgentActivityItem, 'clientName' | 'credentialKind'>): string {
  if (item.clientName) return item.clientName;
  if (item.credentialKind === 'pat') return 'Personal access token';
  if (item.credentialKind === 'session') return 'Vault session';
  return 'Unknown app';
}

interface Envelope {
  data?: AgentActivityItem[] | { items: AgentActivityItem[]; meta?: Record<string, number> };
  meta?: { total?: number; totalItems?: number };
}

/**
 * One page of the caller's agent activity. Read through the raw body (the shared client drops
 * `meta` when it unwraps `{ data }`), and tolerant of both list envelopes the API uses.
 */
export async function getAgentActivity(query: AgentActivityQuery = {}): Promise<AgentActivityPage> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.action) params.set('action', query.action);
  if (query.secretId) params.set('secretId', query.secretId);
  if (query.clientId) params.set('clientId', query.clientId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const qs = params.toString();
  const { blob } = await api.get<{ blob: Blob }>(`/agent-activity${qs ? `?${qs}` : ''}`, {
    responseType: 'blobWithHeaders',
  });
  const body = JSON.parse(await blob.text()) as Envelope;
  const data = body.data;
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  const meta = body.meta ?? (Array.isArray(data) ? undefined : data?.meta);
  const total = meta?.total ?? meta?.totalItems ?? items.length;
  return { items, total };
}
