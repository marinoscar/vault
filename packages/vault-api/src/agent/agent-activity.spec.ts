import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { agentActivityItemSchema, agentActivityQuerySchema } from '@marinoscar/vault-contract/agent';

import { AgentActivityController } from './agent-activity.controller';
import { AgentActivityService } from './agent-activity.service';

const USER = 'user-aaa';
const SECRET = '11111111-1111-4111-8111-111111111111';
const CANARY = 'canary-Pw-9f3k2m!x';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  createdAt: new Date('2030-01-02T03:04:05.000Z'),
  action: 'agent.credential.fill',
  targetId: SECRET,
  meta: {
    result: 'ok', credential: 'oauth', clientId: 'client-1', grantId: 'grant-1', secretId: SECRET,
    field: 'password', origin: 'https://shop.example.test', purpose: 'login',
  },
  ...over,
});

function build(rows: unknown[] = [row()]) {
  const prisma = {
    auditEvent: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
    },
    secret: { findMany: jest.fn().mockResolvedValue([{ id: SECRET, name: 'Shop login' }]) },
    oAuthClient: { findMany: jest.fn().mockResolvedValue([{ id: 'client-1', name: 'Agent App A' }]) },
  };
  return { prisma, service: new AgentActivityService(prisma as never) };
}
const query = (over: Record<string, unknown> = {}) => agentActivityQuerySchema.parse(over);

describe('AgentActivityService', () => {
  it('returns only the caller\'s events, of the agent actions and the toggle, newest first', async () => {
    const { service, prisma } = build();
    await service.list(USER, query());
    const args = prisma.auditEvent.findMany.mock.calls[0]![0];
    expect(args.where.actorUserId).toBe(USER);
    const [agentRows, revealRows] = args.where.OR;
    expect(revealRows).toEqual({ action: 'mcp.tool.call', AND: [{ meta: { path: ['tool'], equals: 'reveal_secret' } }] });
    expect(agentRows.action.in).toEqual([
      'agent.credential.lookup', 'agent.credential.fill', 'agent.credential.totp',
      'agent.credential.create', 'agent.credential.rotate', 'secret.agent_access.update',
      'agent.card.lookup', 'agent.card.fill', 'agent.card.grant_request', 'agent.identity.lookup', 'agent.identity.fill',
      'secret.card_grant.create', 'secret.card_grant.revoke', 'secret.card_grant_request.approve', 'secret.card_grant_request.decline',
      'agent.service_key.read',
    ]);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(prisma.auditEvent.count.mock.calls[0]![0].where.actorUserId).toBe(USER);
    // Secret names are looked up for the caller's own secrets only.
    expect(prisma.secret.findMany.mock.calls[0]![0].where).toMatchObject({ createdById: USER });
  });

  it('maps a row to the documented item and resolves the secret and client names', async () => {
    const { service } = build();
    const result = await service.list(USER, query());
    expect(result).toEqual({
      data: [{
        id: 'e1', at: '2030-01-02T03:04:05.000Z', action: 'fill', result: 'ok', secretId: SECRET, secretName: 'Shop login',
        field: 'password', origin: 'https://shop.example.test', purpose: 'login', credentialKind: 'oauth',
        clientId: 'client-1', clientName: 'Agent App A', amount: null, currency: null,
      }],
      meta: { page: 1, pageSize: 25, total: 1 },
    });
    expect(agentActivityItemSchema.parse(result.data[0])).toBeTruthy();
  });

  it('maps denials with their reason, deleted secrets and unknown clients to null names, and a PAT without a client', async () => {
    const { service, prisma } = build([
      row({ meta: { result: 'denied:origin_mismatch', credential: 'pat', tokenId: 'pat-1', secretId: SECRET, field: 'password', origin: 'https://evil.example.test', purpose: 'login' } }),
      row({ id: 'e2', action: 'agent.credential.lookup', meta: { result: 'ok', credential: 'oauth', clientId: 'client-9', secretId: null, origin: 'https://x.example.test', matches: 2 } }),
    ]);
    prisma.secret.findMany.mockResolvedValue([]);
    const { data } = await service.list(USER, query());
    expect(data[0]).toMatchObject({ result: 'denied', reason: 'origin_mismatch', secretName: null, credentialKind: 'pat', clientId: null, clientName: null });
    expect(data[1]).toMatchObject({ action: 'lookup', secretId: null, secretName: null, clientId: 'client-9', clientName: null });
  });

  it('shows the toggle as agent_access with the new level in `field`', async () => {
    const { service } = build([row({ action: 'secret.agent_access.update', meta: { secretId: SECRET, from: 'none', to: 'fill' } })]);
    const { data } = await service.list(USER, query());
    expect(data[0]).toMatchObject({ action: 'agent_access', result: 'ok', secretId: SECRET, field: 'fill', credentialKind: 'session', clientId: null });
  });

  it('shows a reveal_secret call as mcp_reveal with the field NAME, and a refusal as denied', async () => {
    const { service, prisma } = build([
      row({ id: 'r1', action: 'mcp.tool.call', meta: { tool: 'reveal_secret', result: 'ok', credential: 'oauth', clientId: 'client-1', secretId: SECRET, field: 'password' } }),
      row({ id: 'r2', action: 'mcp.tool.call', meta: { tool: 'reveal_secret', result: 'error:not_found', credential: 'oauth', clientId: 'client-1', secretId: null } }),
    ]);
    const { data } = await service.list(USER, query({ action: 'mcp_reveal' }));
    expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toMatchObject({
      actorUserId: USER, action: 'mcp.tool.call', AND: [{ meta: { path: ['tool'], equals: 'reveal_secret' } }],
    });
    expect(data[0]).toMatchObject({ action: 'mcp_reveal', result: 'ok', secretId: SECRET, secretName: 'Shop login', field: 'password', credentialKind: 'oauth', clientName: 'Agent App A' });
    expect(data[1]).toMatchObject({ action: 'mcp_reveal', result: 'denied', reason: 'not_found', field: null });
  });

  it('applies the filters: action, secret, client and the date range; and paginates', async () => {
    const { service, prisma } = build();
    await service.list(USER, query({
      page: '3', pageSize: '10', action: 'agent_access', secretId: SECRET, clientId: 'client-1',
      from: '2030-01-01T00:00:00.000Z', to: '2030-02-01T00:00:00.000Z',
    }));
    const args = prisma.auditEvent.findMany.mock.calls[0]![0];
    expect(args).toMatchObject({ skip: 20, take: 10 });
    expect(args.where).toMatchObject({
      actorUserId: USER, action: { in: ['secret.agent_access.update'] }, targetType: 'secret', targetId: SECRET,
      meta: { path: ['clientId'], equals: 'client-1' },
      createdAt: { gte: new Date('2030-01-01T00:00:00.000Z'), lte: new Date('2030-02-01T00:00:00.000Z') },
    });
  });

  it('never returns a value: only the documented keys, whatever the stored meta holds', async () => {
    const { service } = build([row({ meta: { ...row().meta, password: CANARY, value: CANARY, code: CANARY, seed: CANARY } })]);
    const result = await service.list(USER, query());
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(Object.keys(result.data[0]!).sort()).toEqual(
      ['action', 'amount', 'at', 'clientId', 'clientName', 'credentialKind', 'currency', 'field', 'id', 'origin', 'purpose', 'result', 'secretId', 'secretName'],
    );
  });

  it('maps card and identity calls with the amount, an in-process host by its label, and the owner\'s grant decisions', async () => {
    const { service, prisma } = build([
      row({ action: 'agent.card.fill', meta: { result: 'denied:amount_exceeded', credential: 'embedded', clientLabel: 'Host A', secretId: SECRET, field: 'number', origin: 'https://shop.example.test', purpose: 'purchase', amount: '42.50', currency: 'USD' } }),
      row({ id: 'e2', action: 'secret.card_grant.create', meta: { credential: 'session', secretId: SECRET, origin: 'https://shop.example.test', amount: '100.00', currency: 'USD' } }),
      row({ id: 'e3', action: 'agent.identity.fill', meta: { result: 'ok', credential: 'pat', tokenId: 'p1', secretId: SECRET, field: 'full_name', origin: 'https://form.example.test', purpose: 'form' } }),
    ]);
    prisma.secret.findMany.mockResolvedValue([{ id: SECRET, name: 'Card A' }]);
    const { data } = await service.list(USER, query());
    expect(data[0]).toMatchObject({ action: 'card_fill', result: 'denied', reason: 'amount_exceeded', credentialKind: 'embedded', clientName: 'Host A', amount: '42.50', currency: 'USD' });
    expect(data[1]).toMatchObject({ action: 'card_grant', field: 'created', credentialKind: 'session', amount: '100.00', secretName: 'Card A' });
    expect(data[2]).toMatchObject({ action: 'identity_fill', field: 'full_name', credentialKind: 'pat', amount: null });
    for (const item of data) expect(agentActivityItemSchema.parse(item)).toBeTruthy();
  });

  it('maps a service key read with its service and key name, and no website (#241)', async () => {
    const { service, prisma } = build([
      row({ action: 'agent.service_key.read', meta: { result: 'ok', credential: 'embedded', clientLabel: 'Host A', secretId: SECRET, field: 'key', origin: null, purpose: 'service_call', service: 'web_search', keyName: 'provider_a', value: CANARY } }),
    ]);
    prisma.secret.findMany.mockResolvedValue([{ id: SECRET, name: 'Search key' }]);
    const { data } = await service.list(USER, query({ action: 'service_key' }));
    expect(prisma.auditEvent.findMany.mock.calls[0]![0].where.action).toEqual({ in: ['agent.service_key.read'] });
    expect(data[0]).toMatchObject({ action: 'service_key', service: 'web_search', keyName: 'provider_a', origin: null, purpose: 'service_call', secretName: 'Search key', clientName: 'Host A' });
    expect(JSON.stringify(data)).not.toContain(CANARY);
    expect(agentActivityItemSchema.parse(data[0])).toBeTruthy();
  });

  it('filters card_grant by the four owner decisions', async () => {
    const { service, prisma } = build();
    await service.list(USER, query({ action: 'card_grant' }));
    expect(prisma.auditEvent.findMany.mock.calls[0]![0].where.action).toEqual({
      in: ['secret.card_grant.create', 'secret.card_grant.revoke', 'secret.card_grant_request.approve', 'secret.card_grant_request.decline'],
    });
  });

  it('skips a row whose action is not one of ours', async () => {
    const { service } = build([row({ action: 'secret.update' })]);
    expect((await service.list(USER, query())).data).toEqual([]);
  });
});

describe('agentActivityQuerySchema', () => {
  it('caps pageSize at 100 and defaults page 1 / 25', () => {
    expect(query()).toMatchObject({ page: 1, pageSize: 25 });
    expect(agentActivityQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(agentActivityQuerySchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(agentActivityQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });
});

describe('AgentActivityController', () => {
  const user = { id: USER } as never;
  const make = () => {
    const service = { list: jest.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } }) };
    return { service, controller: new AgentActivityController(service as unknown as AgentActivityService) };
  };

  it('refuses an OAuth access token with 403 AGENT_ACTIVITY_FORBIDDEN and never reads the trail', async () => {
    const { controller, service } = make();
    const oauth = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'agent', scopes: [] } as never;
    await expect(controller.list(query(), user, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list(query(), user, oauth)).rejects.toMatchObject({ response: { code: 'AGENT_ACTIVITY_FORBIDDEN' } });
    expect(service.list).not.toHaveBeenCalled();
  });

  it('serves a session and a PAT, scoped to the caller', async () => {
    const { controller, service } = make();
    await controller.list(query(), user, null);
    await controller.list(query(), user, { kind: 'pat', tokenId: 'p' } as never);
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(service.list).toHaveBeenCalledWith(USER, expect.anything());
  });
});
