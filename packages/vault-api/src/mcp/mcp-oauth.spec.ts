import {
  VAULT_MCP_RESOURCES,
  VAULT_MCP_RESOURCE_ID,
  VAULT_MCP_RESOURCE_PATH,
  VAULT_MCP_SCOPES,
  VAULT_MCP_SCOPE_DEFINITIONS,
} from './mcp-oauth';
import { VAULT_AGENT_RESOURCE_PATH, VAULT_OAUTH_SCOPES } from '../agent/agent-oauth';

describe('Vault MCP OAuth declarations', () => {
  it('uses colon scope ids (the platform refuses dots) and maps them to the secrets permissions', () => {
    expect(VAULT_MCP_SCOPES).toEqual({ READ: 'vault:mcp_read', WRITE: 'vault:mcp_write', REVEAL: 'vault:mcp_reveal' });
    const byId = Object.fromEntries(VAULT_MCP_SCOPE_DEFINITIONS.map((s) => [s.id, s]));
    expect(byId['vault:mcp_read']).toMatchObject({ permissions: ['secrets:read'], default: true, risk: 'low' });
    expect(byId['vault:mcp_write']).toMatchObject({ permissions: ['secrets:read', 'secrets:write'], risk: 'elevated' });
    expect(byId['vault:mcp_write']!.default).toBeUndefined();
    expect(byId['vault:mcp_reveal']).toMatchObject({ permissions: ['secrets:read'], risk: 'high' });
    expect(byId['vault:mcp_reveal']!.default).toBeUndefined();
    expect(byId['vault:mcp_reveal']!.title).toBe('Read the values of secrets you chose to reveal');
    expect(byId['vault:mcp_reveal']!.description).toMatch(/one field at a time/);
    for (const s of VAULT_MCP_SCOPE_DEFINITIONS) expect(s.id).toMatch(/^[a-z]+:[a-z_]+$/);
  });

  it('declares the mcp resource with offline_access and a prefix that does not overlap the agent API', () => {
    expect(VAULT_MCP_RESOURCES).toHaveLength(1);
    const resource = VAULT_MCP_RESOURCES[0]!;
    expect(resource).toMatchObject({ id: VAULT_MCP_RESOURCE_ID, path: '/api/mcp', routePrefixes: ['/api/mcp'] });
    expect(resource.scopes).toEqual(['vault:mcp_read', 'vault:mcp_write', 'vault:mcp_reveal', 'offline_access']);
    expect(VAULT_MCP_RESOURCE_PATH.startsWith(VAULT_AGENT_RESOURCE_PATH)).toBe(false);
    expect(VAULT_AGENT_RESOURCE_PATH.startsWith(VAULT_MCP_RESOURCE_PATH)).toBe(false);
    expect(resource.scopes.some((s) => Object.values(VAULT_OAUTH_SCOPES).includes(s as never))).toBe(false);
  });
});
