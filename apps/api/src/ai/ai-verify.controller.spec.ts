import { HttpStatus } from '@nestjs/common';

import { RequestUser } from '../auth/interfaces/authenticated-user.interface';

import { AI_ERROR_CODES } from './ai.constants';
import { AiVerifyController } from './ai-verify.controller';
import { AiVerifyService } from './ai-verify.service';
import { AiException, aiNotConfigured, aiRateLimited } from './ai.errors';
import { VerifyAiDto } from './dto/verify-ai.dto';

// Constructed directly rather than through Test.createTestingModule: the
// @Auth() decorator pulls in the whole JwtAuthGuard dependency graph, which
// says nothing about the behaviour under test here.
describe('AiVerifyController', () => {
  let controller: AiVerifyController;
  let aiVerify: jest.Mocked<Pick<AiVerifyService, 'verify'>>;
  let reply: { header: jest.Mock };

  const admin: RequestUser = {
    id: 'admin-1',
    email: 'admin@example.com',
    roles: ['Admin'],
    permissions: ['system_settings:write'],
    isActive: true,
  };

  beforeEach(() => {
    aiVerify = { verify: jest.fn() } as any;
    controller = new AiVerifyController(aiVerify as unknown as AiVerifyService);
    reply = { header: jest.fn() };
  });

  it('wraps a successful check in the standard data envelope', async () => {
    aiVerify.verify.mockResolvedValue({
      ok: true,
      model: 'gpt-5.4-mini-2026-03-01',
      imageSupport: true,
      durationMs: 811,
      adaptedParameters: [],
    });

    await expect(controller.verify(admin, {} as VerifyAiDto, reply as any)).resolves.toEqual({
      data: {
        ok: true,
        model: 'gpt-5.4-mini-2026-03-01',
        imageSupport: true,
        durationMs: 811,
        adaptedParameters: [],
      },
    });
  });

  it('returns a provider failure as a 200 body, not as an exception', async () => {
    // The route is @HttpCode(200). A failed diagnosis is still a successful
    // diagnosis, and - critically - an upstream credential rejection must never
    // reach the browser as a 401, which apps/web reads as an expired session.
    aiVerify.verify.mockResolvedValue({
      ok: false,
      reason: 'invalid_key',
      message: 'The provider rejected the stored API key.',
      model: 'gpt-5.4-mini',
      durationMs: 240,
      adaptedParameters: [],
    });

    const response = await controller.verify(admin, {} as VerifyAiDto, reply as any);

    expect(response.data.ok).toBe(false);
    expect((response.data as any).reason).toBe('invalid_key');
  });

  it('passes a model override through to the service', async () => {
    await controller.verify(
      admin,
      { model: 'gpt-5.4-nano' } as VerifyAiDto,
      reply as any,
    );

    expect(aiVerify.verify).toHaveBeenCalledWith(admin, {
      model: 'gpt-5.4-nano',
    });
  });

  it('asks for the stored model when the body carries no override', async () => {
    await controller.verify(admin, {} as VerifyAiDto, reply as any);

    expect(aiVerify.verify).toHaveBeenCalledWith(admin, {});
  });

  it('sets Retry-After when the check is rate limited', async () => {
    aiVerify.verify.mockRejectedValue(aiRateLimited(42));

    await expect(controller.verify(admin, {} as VerifyAiDto, reply as any)).rejects.toBeInstanceOf(
      AiException,
    );

    expect(reply.header).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('propagates the 503 when no key is stored, without a Retry-After', async () => {
    aiVerify.verify.mockRejectedValue(aiNotConfigured());

    const error: AiException = await controller
      .verify(admin, {} as VerifyAiDto, reply as any)
      .then(() => {
        throw new Error('Expected the call to reject');
      })
      .catch((e) => e as AiException);

    expect(error).toBeInstanceOf(AiException);
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error.code).toBe(AI_ERROR_CODES.NOT_CONFIGURED);
    expect(reply.header).not.toHaveBeenCalled();
  });
});
