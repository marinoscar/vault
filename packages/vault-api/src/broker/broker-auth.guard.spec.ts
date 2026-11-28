import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { BROKER_CALLER_KEY, BrokerAuthGuard } from './broker-auth.guard';

function context(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const request: any = { headers, ...extra };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
}

function setup() {
  const tokens = { resolve: jest.fn() };
  const platform = { canActivate: jest.fn() };
  const moduleRef = { create: jest.fn().mockResolvedValue(platform) };
  return { tokens, platform, moduleRef, guard: new BrokerAuthGuard(tokens as never, moduleRef as never) };
}

const codeOf = (e: ForbiddenException) => (e.getResponse() as { code?: string }).code;

describe('BrokerAuthGuard (ADR-0006 decision 2)', () => {
  it('401 with no credential', async () => {
    const t = setup();
    await expect(t.guard.canActivate(context().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(t.guard.canActivate(context({ authorization: '   ' }).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a live broker token and records who and what it may reach, never the token', async () => {
    const t = setup();
    t.tokens.resolve.mockResolvedValue({ tokenId: 'tok-1', userId: 'user-aaa', secretIds: ['s1'] });
    const { request, ctx } = context({ authorization: 'Bearer vbk_abc' });
    expect(await t.guard.canActivate(ctx)).toBe(true);
    expect(request[BROKER_CALLER_KEY]).toEqual({ kind: 'broker', userId: 'user-aaa', tokenId: 'tok-1', secretIds: ['s1'] });
    expect(JSON.stringify(request[BROKER_CALLER_KEY])).not.toContain('vbk_abc');
    expect(t.tokens.resolve).toHaveBeenCalledWith('vbk_abc');
    expect(t.platform.canActivate).not.toHaveBeenCalled();
    expect(t.moduleRef.create).not.toHaveBeenCalled();
  });

  it('401 for an unknown, revoked or expired broker token (one answer)', async () => {
    const t = setup();
    t.tokens.resolve.mockResolvedValue(null);
    await expect(t.guard.canActivate(context({ authorization: 'Bearer vbk_nope' }).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('delegates a personal access token to the platform guard and takes the caller from what it set', async () => {
    const t = setup();
    t.platform.canActivate.mockResolvedValue(true);
    const { request, ctx } = context({ authorization: 'Bearer pat_abc' }, { user: { id: 'user-aaa' }, authCredential: { kind: 'pat', tokenId: 'pat-1' } });
    expect(await t.guard.canActivate(ctx)).toBe(true);
    expect(request[BROKER_CALLER_KEY]).toEqual({ kind: 'pat', userId: 'user-aaa', tokenId: 'pat-1', secretIds: [] });
    expect(t.tokens.resolve).not.toHaveBeenCalled();
    // The platform guard skips a `@Public()` handler: it must be handed a view with no marker on it.
    const handed = t.platform.canActivate.mock.calls[0]![0] as ExecutionContext;
    expect(handed.getClass()).toBe(BrokerAuthGuard);
    expect(handed.switchToHttp().getRequest()).toBe(request);
  });

  it('a PAT the platform rejects stays the platform\'s 401', async () => {
    const t = setup();
    t.platform.canActivate.mockRejectedValue(new UnauthorizedException('Invalid or expired personal access token'));
    await expect(t.guard.canActivate(context({ authorization: 'Bearer pat_bad' }).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['an OAuth access token', 'Bearer oat_abc'],
    ['a session JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
    ['a node credential', 'Bearer nod_abc'],
    ['basic auth', 'Basic dXNlcjpwdw=='],
    ['a lower-case scheme', 'bearer vbk_abc'],
  ])('refuses %s with 403 BROKER_CREDENTIAL_REFUSED, without looking anything up', async (_label, authorization) => {
    const t = setup();
    const error = await t.guard.canActivate(context({ authorization }).ctx).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(codeOf(error)).toBe('BROKER_CREDENTIAL_REFUSED');
    expect(t.tokens.resolve).not.toHaveBeenCalled();
    expect(t.platform.canActivate).not.toHaveBeenCalled();
  });

  it('refuses when the platform guard admitted something that is not a PAT', async () => {
    const t = setup();
    t.platform.canActivate.mockResolvedValue(true);
    const { ctx } = context({ authorization: 'Bearer pat_abc' }, { user: { id: 'u' }, authCredential: { kind: 'jwt' } });
    await expect(t.guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
