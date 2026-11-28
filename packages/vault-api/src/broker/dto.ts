import { createZodDto } from 'nestjs-zod';
import { createBrokerTokenSchema, updateBrokerAccessSchema } from '@marinoscar/vault-contract/broker';

export class CreateBrokerTokenDto extends createZodDto(createBrokerTokenSchema) {}
export class UpdateBrokerAccessDto extends createZodDto(updateBrokerAccessSchema) {}
