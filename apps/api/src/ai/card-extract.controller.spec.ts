import { HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { AI_ERROR_CODES } from './ai.constants';
import { AiException } from './ai.errors';
import { AiController } from './ai.controller';
import { CardExtractController } from './card-extract.controller';
import { CardExtractService } from './card-extract.service';

const user: RequestUser = {
  id: 'user-aaa',
  email: 'ada@example.com',
  roles: ['contributor'],
  permissions: [PERMISSIONS.SECRETS_WRITE],
  isActive: true,
};

function buildReply() {
  return { header: jest.fn() } as unknown as jest.Mocked<
    Pick<FastifyReply, 'header'>
  > &
    FastifyReply;
}

describe('CardExtractController', () => {
  let controller: CardExtractController;
  let service: jest.Mocked<Pick<CardExtractService, 'extract'>>;

  beforeEach(() => {
    service = { extract: jest.fn() } as any;
    controller = new CardExtractController(
      service as unknown as CardExtractService,
    );
  });

  describe('authorization metadata', () => {
    it('declares secrets:write on the extract route', () => {
      // Without a declared permission the PermissionsGuard never runs, and
      // @CurrentUser() would hand back the raw Prisma user - which has no
      // `.permissions` array - to a secrets-adjacent route.
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        CardExtractController.prototype.extract,
      );

      expect(permissions).toEqual([PERMISSIONS.SECRETS_WRITE]);
    });

    it('declares no permission on the AI status route', () => {
      // Any signed-in user must be able to discover whether the feature exists.
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AiController.prototype.status,
      );

      expect(permissions).toBeUndefined();
    });

    it('responds 200, not 201, to the POST', () => {
      const status = Reflect.getMetadata(
        '__httpCode__',
        CardExtractController.prototype.extract,
      );

      expect(status).toBe(HttpStatus.OK);
    });
  });

  describe('responses', () => {
    it('wraps the result in a data envelope', async () => {
      const result = { fields: {}, confidence: {}, warnings: [], model: 'm', partial: false };
      service.extract.mockResolvedValue(result as any);
      const reply = buildReply();

      await expect(
        controller.extract({ front: 'x' }, user, reply),
      ).resolves.toEqual({ data: result });
      expect(reply.header).not.toHaveBeenCalled();
    });

    it('sets Retry-After when the burst limiter denies the request', async () => {
      service.extract.mockRejectedValue(
        new AiException(429, AI_ERROR_CODES.RATE_LIMITED, 'slow down', 90),
      );
      const reply = buildReply();

      await expect(
        controller.extract({ front: 'x' }, user, reply),
      ).rejects.toBeInstanceOf(AiException);

      expect(reply.header).toHaveBeenCalledWith('Retry-After', '90');
    });

    it('sets Retry-After when the provider rate limits us', async () => {
      service.extract.mockRejectedValue(
        new AiException(
          429,
          AI_ERROR_CODES.UPSTREAM_RATE_LIMITED,
          'upstream',
          30,
        ),
      );
      const reply = buildReply();

      await expect(
        controller.extract({ front: 'x' }, user, reply),
      ).rejects.toBeInstanceOf(AiException);

      expect(reply.header).toHaveBeenCalledWith('Retry-After', '30');
    });

    it('sets no Retry-After on failures that are not worth retrying', async () => {
      service.extract.mockRejectedValue(
        new AiException(502, AI_ERROR_CODES.UPSTREAM_AUTH, 'bad key'),
      );
      const reply = buildReply();

      await expect(
        controller.extract({ front: 'x' }, user, reply),
      ).rejects.toBeInstanceOf(AiException);

      expect(reply.header).not.toHaveBeenCalled();
    });

    it('re-throws non-AI errors untouched', async () => {
      const boom = new Error('boom');
      service.extract.mockRejectedValue(boom);
      const reply = buildReply();

      await expect(controller.extract({ front: 'x' }, user, reply)).rejects.toBe(
        boom,
      );
    });
  });
});
