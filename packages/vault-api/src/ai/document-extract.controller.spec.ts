import { HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { JwtAuthGuard, PERMISSIONS_KEY, RequestUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../core/roles.constants';

import { AI_ERROR_CODES } from './ai.constants';
import { AiException } from './ai.errors';
import { CardExtractController } from './card-extract.controller';
import { DocumentExtractController } from './document-extract.controller';
import { DocumentExtractService } from './document-extract.service';

const user: RequestUser = {
  id: 'user-aaa',
  email: 'person.a@example.test',
  roles: ['contributor'],
  permissions: [PERMISSIONS.SECRETS_WRITE, 'ai:use'],
  isActive: true,
};

const buildReply = () => ({ header: jest.fn() }) as unknown as FastifyReply & { header: jest.Mock };

describe('DocumentExtractController', () => {
  let service: { extract: jest.Mock };
  let controller: DocumentExtractController;

  beforeEach(() => {
    service = { extract: jest.fn() };
    controller = new DocumentExtractController(service as unknown as DocumentExtractService);
  });

  it('is POST /secrets/documents/extract, answering 200', () => {
    expect(Reflect.getMetadata('path', DocumentExtractController)).toBe('secrets/documents');
    expect(Reflect.getMetadata('path', DocumentExtractController.prototype.extract)).toBe('extract');
    expect(Reflect.getMetadata('__httpCode__', DocumentExtractController.prototype.extract)).toBe(HttpStatus.OK);
  });

  it('applies exactly the card route guards: secrets:write + ai:use, JWT, then the kill switch', () => {
    const permissions = Reflect.getMetadata(PERMISSIONS_KEY, DocumentExtractController.prototype.extract);
    expect(permissions).toEqual([PERMISSIONS.SECRETS_WRITE, 'ai:use']);
    expect(permissions).toEqual(Reflect.getMetadata(PERMISSIONS_KEY, CardExtractController.prototype.extract));

    const guards = (Reflect.getMetadata('__guards__', DocumentExtractController.prototype.extract) ?? []) as Array<{ name: string }>;
    const cardGuards = (Reflect.getMetadata('__guards__', CardExtractController.prototype.extract) ?? []) as Array<{ name: string }>;
    expect(guards.map((g) => g.name)).toEqual(cardGuards.map((g) => g.name));
    expect(guards).toContain(JwtAuthGuard);
    expect(guards.map((g) => g.name).at(-1)).toBe('AiEnabledGuard');
  });

  it('wraps the result in a data envelope', async () => {
    const result = { documentType: 'passport', fields: {} };
    service.extract.mockResolvedValue(result);
    const reply = buildReply();
    await expect(controller.extract({ documentType: 'passport' }, user, reply)).resolves.toEqual({ data: result });
    expect(service.extract).toHaveBeenCalledWith({ documentType: 'passport' }, user);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it('sets Retry-After from the AiException', async () => {
    service.extract.mockRejectedValue(new AiException(429, AI_ERROR_CODES.RATE_LIMITED, 'slow down', 90));
    const reply = buildReply();
    await expect(controller.extract({}, user, reply)).rejects.toBeInstanceOf(AiException);
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '90');
  });

  it('passes other errors through without a header', async () => {
    service.extract.mockRejectedValue(new AiException(400, AI_ERROR_CODES.INVALID_IMAGE, 'bad'));
    const reply = buildReply();
    await expect(controller.extract({}, user, reply)).rejects.toMatchObject({ code: AI_ERROR_CODES.INVALID_IMAGE });
    expect(reply.header).not.toHaveBeenCalled();
  });
});
