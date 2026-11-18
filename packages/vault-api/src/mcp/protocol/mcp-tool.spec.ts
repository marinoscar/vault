import { z } from 'zod';

import { McpRedactionError, McpToolRegistry, assertNoSensitiveValues, toolAnnotations, toolListEntry, type McpToolDefinition } from './mcp-tool';

const tool = (over: Partial<McpToolDefinition> = {}): McpToolDefinition => ({
  name: 'do_thing',
  title: 'Do a thing',
  description: 'Does a thing.',
  input: z.object({ a: z.string().optional() }),
  scope: 'vault:mcp_read',
  permission: 'secrets:read',
  effect: 'read',
  handler: async () => ({ data: {} }),
  ...over,
});

describe('McpToolRegistry', () => {
  it('registers a complete tool and lists it in order', () => {
    const registry = new McpToolRegistry();
    registry.register(tool());
    registry.register(tool({ name: 'second' }));
    expect(registry.all().map((t) => t.name)).toEqual(['do_thing', 'second']);
    expect(registry.get('second')?.title).toBe('Do a thing');
  });

  it.each([
    ['a missing title', { title: '' }],
    ['a missing description', { description: ' ' }],
    ['a missing scope', { scope: '' }],
    ['a dotted scope', { scope: 'vault.mcp.read' }],
    ['a missing permission', { permission: '' }],
    ['an invalid effect', { effect: 'destroy' as never }],
    ['a read tool marked destructive', { destructive: true }],
    ['a bad name', { name: 'Do-Thing' }],
  ])('refuses %s', (_label, over) => {
    expect(() => new McpToolRegistry().register(tool(over as Partial<McpToolDefinition>))).toThrow(/invalid/);
  });

  it('refuses a duplicate name', () => {
    const registry = new McpToolRegistry();
    registry.register(tool());
    expect(() => registry.register(tool())).toThrow(/already registered/);
  });
});

describe('tool annotations and list entries', () => {
  it('derives the hints from the effect', () => {
    expect(toolAnnotations(tool())).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(toolAnnotations(tool({ effect: 'write' }))).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(toolAnnotations(tool({ effect: 'write', destructive: true, idempotent: true }))).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it('lists title only for revisions that have it, always the scope and an input schema', () => {
    const withTitle = toolListEntry(tool(), { toolTitle: true });
    const without = toolListEntry(tool(), { toolTitle: false });
    expect(withTitle.title).toBe('Do a thing');
    expect(without).not.toHaveProperty('title');
    expect((withTitle.inputSchema as { type: string }).type).toBe('object');
    expect(withTitle.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['vault:mcp_read'] }]);
  });
});

describe('assertNoSensitiveValues (fail closed)', () => {
  it('passes a clean result and ignores empty sensitive values', () => {
    expect(() => assertNoSensitiveValues({ a: 'fine', b: ['x'] }, ['', 'Secret-Value-1'])).not.toThrow();
    expect(() => assertNoSensitiveValues({ a: 'fine' }, [])).not.toThrow();
  });

  it('throws on an exact match anywhere, including keys and nested arrays', () => {
    expect(() => assertNoSensitiveValues({ a: { b: ['Secret-Value-1'] } }, ['Secret-Value-1'])).toThrow(McpRedactionError);
    expect(() => assertNoSensitiveValues({ 'Secret-Value-1': 'x' }, ['Secret-Value-1'])).toThrow(McpRedactionError);
    expect(() => assertNoSensitiveValues({ a: 'abc' }, ['abc'])).toThrow(McpRedactionError);
  });

  it('throws when a long value is embedded in text, but not a short one', () => {
    expect(() => assertNoSensitiveValues({ a: 'prefix Secret-Value-1 suffix' }, ['Secret-Value-1'])).toThrow(McpRedactionError);
    expect(() => assertNoSensitiveValues({ a: 'xabcx' }, ['abc'])).not.toThrow();
  });

  it('never puts the value in the error', () => {
    try {
      assertNoSensitiveValues({ a: 'Secret-Value-1' }, ['Secret-Value-1']);
    } catch (e) {
      expect((e as Error).message).not.toContain('Secret-Value-1');
    }
  });
});
