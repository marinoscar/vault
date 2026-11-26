import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { AGENT_CONTRACT_VERSION, agentWhoamiResponseSchema } from '@marinoscar/vault-contract/agent';

import { AgentCredentialsService } from './agent-credentials.service';
import { AgentNoStoreInterceptor } from './agent-no-store.interceptor';
import { AgentController } from './agent.controller';
import { AgentCardsController } from './agent-cards.controller';

describe('AgentNoStoreInterceptor', () => {
  it('sets Cache-Control: no-store and Pragma: no-cache before the handler runs', () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => void (headers[k] = v) };
    const context = { switchToHttp: () => ({ getResponse: () => reply }) } as unknown as ExecutionContext;
    let ranHandler = false;
    const next: CallHandler = { handle: () => { ranHandler = true; return of(1); } };
    new AgentNoStoreInterceptor().intercept(context, next);
    expect(headers).toEqual({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    expect(ranHandler).toBe(true);
  });

  it('is applied to the whole agent controller and to the cards and identity controller', () => {
    for (const controller of [AgentController, AgentCardsController]) {
      const interceptors = Reflect.getMetadata('__interceptors__', controller) as unknown[];
      expect(interceptors).toContain(AgentNoStoreInterceptor);
    }
  });
});

describe('AgentController', () => {
  const contract = { version: AGENT_CONTRACT_VERSION, features: ['logins', 'totp', 'save_login'] };

  it('whoami honours the kill switch and returns the caller, scopes, client and contract block', async () => {
    const service = { contractInfo: jest.fn().mockResolvedValue(contract) };
    const controller = new AgentController(service as unknown as AgentCredentialsService, {} as never);
    const user = { id: 'u1' } as never;
    await expect(
      controller.whoami(user, { clientId: 'c1', grantId: 'g', resourceId: 'agent', scopes: ['vault:items_read'] }),
    ).resolves.toEqual({ userId: 'u1', scopes: ['vault:items_read'], clientId: 'c1', contract });
    await expect(controller.whoami(user, null)).resolves.toEqual({ userId: 'u1', scopes: [], clientId: null, contract });
    service.contractInfo.mockRejectedValue(new Error('disabled'));
    await expect(controller.whoami(user, null)).rejects.toThrow('disabled');
  });

  it('whoami keeps every field an older client reads (an additive change) and parses with the contract schema', async () => {
    const service = { contractInfo: jest.fn().mockResolvedValue(contract) };
    const controller = new AgentController(service as unknown as AgentCredentialsService, {} as never);
    const data = await controller.whoami({ id: 'u1' } as never, null);
    const parsed = agentWhoamiResponseSchema.parse({ data });
    expect(parsed.data).toMatchObject({ userId: 'u1', scopes: [], clientId: null });
    // A client built before contract 1.2 parses its own shape and ignores the new block.
    const legacy = agentWhoamiResponseSchema.shape.data.omit({ contract: true });
    expect(legacy.parse(data)).toEqual({ userId: 'u1', scopes: [], clientId: null });
  });

  it('contractInfo reports cards and identity only while their switches are on, and refuses while agent access is off', async () => {
    const settings = { enabled: true, cards: { enabled: false }, identity: { enabled: true } };
    const pipeline = {
      loadSettings: jest.fn(async () => settings),
      assertEnabled: jest.fn(async () => { throw new Error('AGENT_ACCESS_DISABLED'); }),
    };
    const service = new AgentCredentialsService({} as never, pipeline as never, {} as never);
    await expect(service.contractInfo()).resolves.toEqual({ version: AGENT_CONTRACT_VERSION, features: ['logins', 'totp', 'save_login', 'service_keys', 'identity'] });
    settings.cards.enabled = true;
    await expect(service.contractInfo()).resolves.toEqual({
      version: AGENT_CONTRACT_VERSION, features: ['logins', 'totp', 'save_login', 'service_keys', 'cards', 'identity'],
    });
    settings.enabled = false;
    await expect(service.contractInfo()).rejects.toThrow('AGENT_ACCESS_DISABLED');
  });
});
