// =============================================================================
// The MCP tool registry (issue #180, E14.8, epic #172)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(mcp): see `mcp-rpc.ts`. A tool declares, at registration, its name, title,
// description, input schema, the OAuth scope that unlocks it, the permission that scope maps to, its
// effect (`read` or `write`) and its annotations. A tool missing any of them does not register: the
// "every tool has a scope, an effect and a title" rule is enforced here, not by convention.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { McpVersionFlags } from './mcp-protocol';

/** What a tool does to the data: `read` leaves it unchanged, `write` creates or changes it. */
export type McpToolEffect = 'read' | 'write';

/** Who is calling and how, as a tool handler sees it. Never carries a token. */
export interface McpToolContext {
  userId: string;
  /** The user's effective permissions (an OAuth token's narrowing already applied). */
  permissions: readonly string[];
}

/** What a tool handler returns. */
export interface McpToolOutput {
  /** The result object; goes to the model as JSON text and as `structuredContent`. */
  data: Record<string, unknown>;
  /** A one-line lead for the text block. */
  summary?: string;
  /** The secret the call touched, for the audit row (an id, never a name or a value). */
  secretId?: string;
  /**
   * Every sensitive value the handler saw (decrypted fields, generated passwords, values the model
   * sent). The dispatcher refuses to return a result in which any of them appears: fail closed.
   */
  sensitive?: readonly string[];
}

/** A tool refusal the model should read: becomes an `isError` result, never an HTTP error. */
export class McpToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly secretId?: string,
  ) {
    super(message);
  }
}

/** One tool. */
export interface McpToolDefinition<I extends z.ZodType = z.ZodType> {
  /** The wire name: lower-case letters, digits and underscores. Permanent once clients use it. */
  name: string;
  /** The human title (`tools/list`, the client's approval prompt). */
  title: string;
  /** What the tool does and what it never returns, written for a model. */
  description: string;
  /** The input schema; advertised as JSON Schema and enforced on every call. */
  input: I;
  /** The OAuth scope that unlocks the tool (`vault:<name>`). */
  scope: string;
  /** The permission the scope maps to; checked against the caller before the handler runs. */
  permission: string;
  /** `read` or `write`. */
  effect: McpToolEffect;
  /** Calling twice with the same arguments leaves the same state (`idempotentHint`). */
  idempotent?: boolean;
  /** The tool may overwrite or remove data (`destructiveHint`; write tools only). */
  destructive?: boolean;
  /** Runs the tool. Receives the parsed arguments. */
  handler(args: z.infer<I>, ctx: McpToolContext): Promise<McpToolOutput>;
}

/** The MCP annotations of a tool. */
export function toolAnnotations(t: Pick<McpToolDefinition, 'title' | 'effect' | 'idempotent' | 'destructive'>) {
  return {
    title: t.title,
    readOnlyHint: t.effect === 'read',
    destructiveHint: t.effect === 'write' && (t.destructive ?? false),
    idempotentHint: t.effect === 'read' ? true : (t.idempotent ?? false),
    openWorldHint: false,
  };
}

/** One `tools/list` entry for a revision (`title` only where the revision has it). */
export function toolListEntry(t: McpToolDefinition, flags: Pick<McpVersionFlags, 'toolTitle'>): Record<string, unknown> {
  return {
    name: t.name,
    ...(flags.toolTitle ? { title: t.title } : {}),
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
    annotations: toolAnnotations(t),
    // ChatGPT's per-tool auth declaration (an extension other clients ignore).
    securitySchemes: [{ type: 'oauth2', scopes: [t.scope] }],
  };
}

const NAME = /^[a-z][a-z0-9_]{1,63}$/;
const SCOPE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

/**
 * The tools of the server. Hosts and slices register theirs once at start-up
 * (`McpToolRegistry.register`); the dispatcher reads them. Registration is validated: a tool without
 * a title, a scope, a permission or an effect throws and the application does not start.
 *
 * @extensionPoint registry
 * @stability experimental
 */
@Injectable()
export class McpToolRegistry {
  private readonly tools = new Map<string, McpToolDefinition>();

  /** Adds a tool. Throws on a duplicate name or incomplete metadata. */
  register<I extends z.ZodType>(tool: McpToolDefinition<I>): void {
    const problems: string[] = [];
    if (!NAME.test(tool.name ?? '')) problems.push('name must be snake_case');
    if (!tool.title?.trim()) problems.push('title is required');
    if (!tool.description?.trim()) problems.push('description is required');
    if (!SCOPE.test(tool.scope ?? '')) problems.push('scope must be a `vault:<name>` scope id');
    if (!tool.permission?.trim()) problems.push('permission is required');
    if (tool.effect !== 'read' && tool.effect !== 'write') problems.push('effect must be read or write');
    if (tool.destructive && tool.effect !== 'write') problems.push('only a write tool can be destructive');
    if (!tool.input) problems.push('input schema is required');
    if (problems.length) throw new Error(`MCP tool "${tool.name}" is invalid: ${problems.join('; ')}`);
    if (this.tools.has(tool.name)) throw new Error(`MCP tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool as unknown as McpToolDefinition);
  }

  /** The tool named `name`, if any. */
  get(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Every tool, in registration order. */
  all(): McpToolDefinition[] {
    return [...this.tools.values()];
  }
}

/** Thrown by {@link assertNoSensitiveValues} when a result carries a value it must not. */
export class McpRedactionError extends Error {
  constructor() {
    // The message names nothing: not the value, not the field.
    super('A tool result carried a sensitive value and was withheld');
  }
}

function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      leaves(v, out);
    }
  }
  return out;
}

/**
 * The fail-closed guard over every tool result: walks the result and throws when any string in it
 * equals, or (for values of 6 or more characters) contains, one of `sensitive`. It is the second
 * line: tools build their results from an allow-list of non-sensitive fields and never see this
 * throw. Empty values are ignored. Never includes the value in the error.
 *
 * @throws McpRedactionError when a sensitive value is present.
 * @stability experimental
 */
export function assertNoSensitiveValues(result: unknown, sensitive: readonly string[]): void {
  const values = [...new Set(sensitive.filter((s) => typeof s === 'string' && s.length > 0))];
  if (values.length === 0) return;
  const strings = leaves(result);
  for (const v of values) {
    for (const s of strings) {
      if (s === v || (v.length >= 6 && s.includes(v))) throw new McpRedactionError();
    }
  }
}
