import { HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { RequestUser, PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../core/roles.constants';

import { AI_ERROR_CODES } from './ai.constants';
import { AiException } from './ai.errors';
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
    it('declares secrets:write and ai:use on the extract route', () => {
      // Without a declared permission the PermissionsGuard never runs, and
      // @CurrentUser() would hand back the raw Prisma user - which has no
      // `.permissions` array - to a secrets-adjacent route.
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        CardExtractController.prototype.extract,
      );

      expect(permissions).toEqual([PERMISSIONS.SECRETS_WRITE, 'ai:use']);
    });

    it('puts the platform kill switch in front of the class', () => {
      const guards = Reflect.getMetadata('__guards__', CardExtractController.prototype.extract) ?? [];
      expect(guards.map((g: { name: string }) => g.name)).toContain('AiEnabledGuard');
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

    it('sets Retry-After when the per-minute limit denies the request', async () => {
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
