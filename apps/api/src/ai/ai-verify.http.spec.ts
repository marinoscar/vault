import { APP_PIPE } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';

import { AiVerifyController } from './ai-verify.controller';
import { AiVerifyService } from './ai-verify.service';
import { MAX_MODEL_NAME_LENGTH } from './ai.constants';

/**
 * The verify route over real HTTP.
 *
 * The unit specs prove the controller and the schema in isolation; this proves
 * the WIRING between them, which is where the override could quietly break:
 *
 *   - a POST with no body at all must still reach the service (the web client
 *     sends neither a body nor a Content-Type when there is no override, so
 *     Fastify hands the pipe `undefined`)
 *   - a POST with `{ model }` must arrive as a parsed override
 *   - a malformed `model` must be stopped by the global pipe with a 400,
 *     before any provider call is made
 *
 * `AiVerifyService` is a mock, so nothing here can reach the network. The
 * guards are stubbed - authorization is covered by the RBAC integration
 * tests - and the stub sets `request.user` the way the real JwtAuthGuard does,
 * because `@CurrentUser()` reads it.
 */
describe('POST /api/system-settings/ai/verify (HTTP)', () => {
  let app: NestFastifyApplication;
  let verify: jest.Mock;

  const admin: RequestUser = {
    id: 'admin-1',
    email: 'admin@example.com',
    roles: ['Admin'],
    permissions: ['system_settings:write'],
    isActive: true,
  };

  const allow = { canActivate: () => true };

  const post = (payload?: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/system-settings/ai/verify',
      // Omitting `payload` entirely sends no body and sets no Content-Type,
      // which is exactly what apps/web does when there is no override. The
      // cast is only needed because these tests deliberately send values the
      // schema must reject.
      ...(payload === undefined ? {} : { payload: payload as never }),
    });

  beforeAll(async () => {
    verify = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [AiVerifyController],
      providers: [
        { provide: AiVerifyService, useValue: { verify } },
        // The same global pipe app.module.ts registers.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = admin;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(PermissionsGuard)
      .useValue(allow)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    verify.mockReset();
    verify.mockResolvedValue({
      ok: true,
      model: 'gpt-5.4-nano-2026-05-01',
      imageSupport: true,
      durationMs: 700,
      adaptedParameters: [],
    });
  });

  it('probes the stored model when no body is sent', async () => {
    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(verify).toHaveBeenCalledWith(admin, {});
  });

  it('probes the stored model when an empty object is sent', async () => {
    const response = await post({});

    expect(response.statusCode).toBe(200);
    expect(verify).toHaveBeenCalledWith(admin, {});
  });

  it('passes an override through to the service', async () => {
    const response = await post({ model: 'gpt-5.4-nano' });

    expect(response.statusCode).toBe(200);
    expect(verify).toHaveBeenCalledWith(admin, { model: 'gpt-5.4-nano' });
  });

  it('returns the model that was probed', async () => {
    const response = await post({ model: 'gpt-5.4-nano' });

    expect(response.json().data.model).toBe('gpt-5.4-nano-2026-05-01');
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an oversized name', 'a'.repeat(MAX_MODEL_NAME_LENGTH + 1)],
    ['a number', 7],
    ['null', null],
  ])('rejects %s with a 400', async (_label, model) => {
    const response = await post({ model });

    expect(response.statusCode).toBe(400);
  });

  it('does not spend a provider call on a rejected body', async () => {
    // The 400 must come from the pipe, before the service - a malformed body
    // should not cost the operator an outbound billable request, nor consume
    // the admin's burst allowance.
    await post({ model: '' });

    expect(verify).not.toHaveBeenCalled();
  });
});
