import { createZodDto } from 'nestjs-zod';
import {
  agentCardFillRequestSchema,
  agentCardGrantRequestCreateSchema,
  agentCardsLookupQuerySchema,
  agentCreateCredentialRequestSchema,
  agentFillRequestSchema,
  agentIdentityFillRequestSchema,
  agentIdentityLookupQuerySchema,
  agentLookupQuerySchema,
  agentRotatePasswordRequestSchema,
  agentTotpRequestSchema,
  cardGrantRequestListQuerySchema,
  createCardGrantSchema,
} from '@marinoscar/vault-contract/agent';

export { agentLookupQuerySchema, agentCardsLookupQuerySchema, agentIdentityLookupQuerySchema, cardGrantRequestListQuerySchema };

export class AgentFillDto extends createZodDto(agentFillRequestSchema) {}
export class AgentTotpDto extends createZodDto(agentTotpRequestSchema) {}
export class AgentCreateCredentialDto extends createZodDto(agentCreateCredentialRequestSchema) {}
export class AgentRotatePasswordDto extends createZodDto(agentRotatePasswordRequestSchema) {}
export class AgentCardFillDto extends createZodDto(agentCardFillRequestSchema) {}
export class AgentCardGrantRequestDto extends createZodDto(agentCardGrantRequestCreateSchema) {}
export class AgentIdentityFillDto extends createZodDto(agentIdentityFillRequestSchema) {}
export class CreateCardGrantDto extends createZodDto(createCardGrantSchema) {}
