import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { AgentCredentialsService } from './agent-credentials.service';
import { AgentNoStoreInterceptor } from './agent-no-store.interceptor';
import { AgentController } from './agent.controller';

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

  it('is applied to the whole agent controller', () => {
    const interceptors = Reflect.getMetadata('__interceptors__', AgentController) as unknown[];
    expect(interceptors).toContain(AgentNoStoreInterceptor);
  });
});

describe('AgentController', () => {
  it('whoami honours the kill switch and returns the caller, scopes and client', async () => {
    const service = { assertEnabled: jest.fn().mockResolvedValue(undefined) };
    const controller = new AgentController(service as unknown as AgentCredentialsService);
    const user = { id: 'u1' } as never;
    await expect(
      controller.whoami(user, { clientId: 'c1', grantId: 'g', resourceId: 'agent', scopes: ['vault:items_read'] }),
    ).resolves.toEqual({ userId: 'u1', scopes: ['vault:items_read'], clientId: 'c1' });
    await expect(controller.whoami(user, null)).resolves.toEqual({ userId: 'u1', scopes: [], clientId: null });
    service.assertEnabled.mockRejectedValue(new Error('disabled'));
    await expect(controller.whoami(user, null)).rejects.toThrow('disabled');
  });
});
