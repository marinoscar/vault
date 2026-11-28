// =============================================================================
// The Vault MCP tools (issue #180, E14.8, epic #172)
// =============================================================================
//
// Six tools for chat assistants. Five never return a secret value: results come from an allow-list of
// non-sensitive fields (`McpSecretsService`) and pass a fail-closed guard in the dispatcher.
// The sixth, `reveal_secret` (#244, ADR-0005), returns ONE field value of a secret the owner switched
// "Reveal to assistants" on for, behind its own scope `vault:mcp_reveal`, a stricter rate limit and an
// audit row naming the field. It is the only tool that declares `revealsField`, and the dispatcher's
// guard is skipped for its `value` key alone. Cards and identity documents are never revealable.
//
//   tool             scope            effect  returns
//   search_secrets   vault:mcp_read   read    id, name, type, origins, agentAccess, non-sensitive fields
//   get_secret       vault:mcp_read   read    the same plus sensitive fields as "[hidden]"
//   list_secret_types vault:mcp_read  read    type names and field definitions
//   create_secret    vault:mcp_write  write   id and metadata (a generated password is NOT returned)
//   update_secret    vault:mcp_write  write   the new version number
//   reveal_secret    vault:mcp_reveal read    id, name, type, field and the ONE field's value
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH,
  AGENT_GENERATED_PASSWORD_MAX_LENGTH,
  AGENT_GENERATED_PASSWORD_MIN_LENGTH,
} from '@marinoscar/vault-contract/agent';

import { VAULT_PERMISSIONS } from '../core/permissions';
import { MCP_SEARCH_MAX_LIMIT, McpSecretsService } from './mcp-secrets.service';
import { VAULT_MCP_SCOPES } from './mcp-oauth';
import { McpToolRegistry, type McpToolDefinition } from './protocol/mcp-tool';

const fieldValue = z.union([z.string().max(10_000), z.number()]);

/** `search_secrets` arguments. */
export const searchSecretsInput = z.object({
  query: z.string().trim().min(1).max(200).optional().describe('Part of the secret name to look for.'),
  type: z.string().trim().min(1).max(100).optional().describe('A secret type name (see list_secret_types). Only logins opened to agents and secrets the user chose to reveal are visible here.'),
  origin: z.string().trim().min(1).max(2048).optional().describe('A website origin such as https://app.example.test; matches logins for that site.'),
  limit: z.number().int().min(1).max(MCP_SEARCH_MAX_LIMIT).optional().describe(`How many results to return (default 20, at most ${MCP_SEARCH_MAX_LIMIT}).`),
});

/** `get_secret` arguments. */
export const getSecretInput = z.object({ id: z.string().uuid().describe('The secret id from search_secrets.') });

/** `list_secret_types` arguments (none). */
export const listSecretTypesInput = z.object({});

/** `create_secret` arguments. */
export const createSecretInput = z.object({
  type: z.string().trim().min(1).max(100).describe('The secret type name, for example Credential or API Key (see list_secret_types). Card is not available.'),
  name: z.string().trim().min(1).max(255).describe('A unique name for the secret.'),
  fields: z.record(z.string().max(100), fieldValue).describe('Field values by field name, as list_secret_types defines them. Omit password when you use generatePassword.'),
  generatePassword: z
    .object({
      length: z.number().int().min(AGENT_GENERATED_PASSWORD_MIN_LENGTH).max(AGENT_GENERATED_PASSWORD_MAX_LENGTH).optional()
        .describe(`Password length (default ${AGENT_GENERATED_PASSWORD_DEFAULT_LENGTH}).`),
      symbols: z.boolean().optional().describe('Include symbols (default true).'),
    })
    .optional()
    .describe('Let Vault generate the password into fields.password. It is stored and NOT returned: the user reads it in Vault.'),
  allowAgents: z.boolean().optional().describe('Credential only. true opens the login to agents so it appears in search_secrets; default false.'),
});

/** `update_secret` arguments. */
export const updateSecretInput = z.object({
  id: z.string().uuid().describe('The secret id from search_secrets.'),
  fields: z.record(z.string().max(100), fieldValue).describe('The fields to change, by name. Other fields keep their values; an empty string clears an optional field. url and additional_urls cannot be changed here.'),
});

/** `reveal_secret` arguments. */
export const revealSecretInput = z.object({
  id: z.string().uuid().describe('The secret id from search_secrets.'),
  field: z.string().trim().min(1).max(100).describe('The name of the one field to read, for example password (see get_secret or list_secret_types).'),
});

/** The six tool definitions over a service. */
export function vaultMcpTools(service: McpSecretsService): McpToolDefinition[] {
  const read = { scope: VAULT_MCP_SCOPES.READ, permission: VAULT_PERMISSIONS.SECRETS_READ.id, effect: 'read' as const };
  const write = { scope: VAULT_MCP_SCOPES.WRITE, permission: VAULT_PERMISSIONS.SECRETS_WRITE.id, effect: 'write' as const };

  const searchSecrets: McpToolDefinition<typeof searchSecretsInput> = {
    ...read,
    name: 'search_secrets',
    title: 'Search secrets',
    description:
      'Find logins the user opened to agents, by name, website or type. Returns id, name, type, origins, agentAccess, updatedAt and the non-sensitive fields (such as the username). Never returns passwords, codes or other secret values.',
    input: searchSecretsInput,
    handler: async (args, ctx) => {
      const { items, sensitive } = await service.search(ctx, args);
      return { data: { items, count: items.length }, summary: `${items.length} secret(s) found.`, sensitive };
    },
  };

  const getSecret: McpToolDefinition<typeof getSecretInput> = {
    ...read,
    name: 'get_secret',
    title: 'Get a secret',
    description:
      'Read one secret the user opened to agents: its metadata and non-sensitive fields. Sensitive fields (password, authenticator key) are shown as "[hidden]"; their values are never returned.',
    input: getSecretInput,
    handler: async (args, ctx) => {
      const { item, sensitive } = await service.get(ctx, args.id);
      return { data: { secret: item }, secretId: item.id, sensitive };
    },
  };

  const listSecretTypes: McpToolDefinition<typeof listSecretTypesInput> = {
    ...read,
    name: 'list_secret_types',
    title: 'List secret types',
    description: 'The secret types Vault has and their field definitions (name, label, type, required, sensitive). Use it before create_secret. Card and identity-document types are not listed.',
    input: listSecretTypesInput,
    handler: async () => ({ data: { types: await service.listTypes() } }),
  };

  const createSecret: McpToolDefinition<typeof createSecretInput> = {
    ...write,
    name: 'create_secret',
    title: 'Create a secret',
    description:
      'Save a new secret for the user. With generatePassword, Vault generates a strong password, stores it and does NOT return it (the user reads it in Vault). Returns the id and metadata only. A secret is visible to search_secrets only when it is a Credential created with allowAgents: true.',
    input: createSecretInput,
    handler: async (args, ctx) => {
      const out = await service.create(ctx, args);
      return { data: out.result, secretId: out.secretId, sensitive: out.sensitive, summary: 'Secret created.' };
    },
  };

  const updateSecret: McpToolDefinition<typeof updateSecretInput> = {
    ...write,
    name: 'update_secret',
    title: 'Update a secret',
    description:
      'Change fields of a login the user opened to agents. Only the fields you send change; a new version is saved (the old one stays recoverable in Vault). Returns the new version number, never a value. The website fields cannot be changed here.',
    input: updateSecretInput,
    idempotent: true,
    handler: async (args, ctx) => {
      const out = await service.update(ctx, args);
      return { data: out.result, secretId: out.secretId, sensitive: out.sensitive };
    },
  };

  const revealSecret: McpToolDefinition<typeof revealSecretInput> = {
    scope: VAULT_MCP_SCOPES.REVEAL,
    permission: VAULT_PERMISSIONS.SECRETS_READ.id,
    effect: 'read' as const,
    name: 'reveal_secret',
    title: 'Reveal one field of a secret',
    description:
      'Read the value of ONE field of a secret the user switched "Reveal to assistants" on for. Returns id, name, type, field and value. ' +
      'Only that secret and field are returned, one per call; every read is recorded for the user. Cards and identity documents are never available. ' +
      'Answers "not found" for a secret that is missing or not opened for revealing. Do not repeat the value to the user unless they asked for it.',
    input: revealSecretInput,
    revealsField: true,
    handler: async (args, ctx) => {
      const out = await service.reveal(ctx, args);
      return { data: out.result, secretId: out.secretId, field: out.field, sensitive: out.sensitive };
    },
  };

  return [searchSecrets, getSecret, listSecretTypes, createSecret, updateSecret, revealSecret] as unknown as McpToolDefinition[];
}

/** Registers the Vault tools with the registry at start-up. */
@Injectable()
export class VaultMcpToolsBootstrap implements OnModuleInit {
  constructor(
    private readonly registry: McpToolRegistry,
    private readonly service: McpSecretsService,
  ) {}

  onModuleInit(): void {
    for (const tool of vaultMcpTools(this.service)) {
      if (!this.registry.get(tool.name)) this.registry.register(tool);
    }
  }
}
