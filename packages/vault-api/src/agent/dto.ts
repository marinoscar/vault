import { createZodDto } from 'nestjs-zod';
import {
  agentCreateCredentialRequestSchema,
  agentFillRequestSchema,
  agentLookupQuerySchema,
  agentRotatePasswordRequestSchema,
  agentTotpRequestSchema,
} from '@marinoscar/vault-contract/agent';

export { agentLookupQuerySchema };

export class AgentFillDto extends createZodDto(agentFillRequestSchema) {}
export class AgentTotpDto extends createZodDto(agentTotpRequestSchema) {}
export class AgentCreateCredentialDto extends createZodDto(agentCreateCredentialRequestSchema) {}
export class AgentRotatePasswordDto extends createZodDto(agentRotatePasswordRequestSchema) {}
