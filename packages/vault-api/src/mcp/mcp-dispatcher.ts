// =============================================================================
// Method routing of the Vault MCP server (issue #180, E14.8, epic #172)
// =============================================================================
//
// One JSON-RPC message in, one response (or none, for a notification) out. Version-specific behaviour
// is read from the request context (`protocol/mcp-protocol.ts`); the transport (status codes, Origin,
// batches) is the controller's. A `tools/call` runs one pipeline:
//
//   unknown tool -> authorize (scope step-up / forbidden: HTTP 403, thrown) -> kill switch
//   (`agentAccess.enabled`, HTTP 403) -> rate limit (HTTP 429) -> validate arguments -> handler ->
//   fail-closed redaction guard -> audit row `mcp.tool.call` -> result.
//
// A refusal about WHO may call is always an HTTP status, never a `200` with an error result (a client
// starts re-consent on a 403, a model only reads a result). Nothing sensitive reaches a log, a span,
// an error or the audit row.
// =============================================================================

import { HttpException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InsufficientScopeException, type AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import {
  AGENT_ACCESS_SETTINGS_DEFAULTS,
  AGENT_ERROR_CODES,
  type AgentAccessSettings,
} from '@marinoscar/vault-contract/agent';

import { VAULT_AUDIT, VAULT_SETTINGS, type VaultAuditPort, type VaultSettingsPort } from '../ports';
import { AgentRateLimiter } from '../agent/agent-rate-limiter';
import { MCP_RATE_PER_MINUTE, VAULT_MCP_OPTIONS, type VaultMcpOptions } from './mcp-options';
import {
  LIST_CACHE_SCOPE,
  LIST_TTL_MS,
  META,
  SUPPORTED_VERSIONS,
  negotiateInitialize,
  type McpRequestContext,
  type RpcMessage,
} from './protocol/mcp-protocol';
import { RPC, errorResult, rpcError, rpcResult, structuredResult, type McpToolResult, type RpcId, type RpcResponse } from './protocol/mcp-rpc';
import {
  McpRedactionError,
  McpToolError,
  McpToolRegistry,
  assertNoSensitiveValues,
  toolListEntry,
  type McpToolDefinition,
} from './protocol/mcp-tool';

/** The audit action of every tool call. */
export const MCP_TOOL_CALL_AUDIT_ACTION = 'mcp.tool.call' as const;

/** The `reveal_secret` limit when the setting holds none (`agentAccess.revealPerMinute`). */
const REVEAL_RATE_PER_MINUTE = 10;

/** The OAuth scope that lets a token read a secret field. */
const REVEAL_SCOPE = 'vault:mcp_reveal';

/** What the server calls itself. */
export const MCP_SERVER_INFO = { name: 'vault', title: 'Vault', version: '0.1.0' } as const;

/** What the model is told on `initialize`. */
export const MCP_INSTRUCTIONS =
  'Vault stores secrets. This server lets you find, create and update them for the user. It shows ' +
  'passwords, API keys, one-time-code seeds and card data as "[hidden]" or not at all; the one exception ' +
  'is reveal_secret, which returns a single field of a secret the user chose to reveal to assistants. To create a login with a strong password, call create_secret with generatePassword: Vault ' +
  'generates the password and keeps it hidden; the user reads it in Vault. You only see logins the user ' +
  'opened to agents.';

/** Who is calling a tool, as the transport proved it. */
export interface McpCaller {
  userId: string;
  /** The user's effective permissions (an OAuth token's narrowing applied). */
  permissions: readonly string[];
  credential: AuthCredentialInfo | null;
  /**
   * Checks the caller may use `tool`: throws the platform's `InsufficientScopeException` (a step-up,
   * HTTP 403 with a challenge) or a `ForbiddenException`. Supplied by the controller, which holds the
   * request the platform's access decision reads.
   */
  authorize(tool: McpToolDefinition): void;
}

/** What the dispatcher answers: the JSON-RPC response and the HTTP status and headers it wants. */
export interface DispatchOutcome {
  status: number;
  body: RpcResponse;
  headers?: Record<string, string>;
}

function principalKey(credential: AuthCredentialInfo | null): string {
  if (credential?.kind === 'oauth') return `oauth:${credential.grantId}`;
  if (credential?.kind === 'pat') return `pat:${credential.tokenId}`;
  return 'session';
}

/** The audit meta of the credential: ids only. */
function credentialMeta(credential: AuthCredentialInfo | null): Record<string, unknown> {
  if (credential?.kind === 'oauth') return { credential: 'oauth', clientId: credential.clientId, grantId: credential.grantId };
  if (credential?.kind === 'pat') return { credential: 'pat', patId: credential.tokenId };
  return { credential: credential?.kind ?? null };
}

/**
 * The MCP method router. Stateless: no session, no stream.
 *
 * @stability experimental
 */
@Injectable()
export class McpDispatcher {
  private readonly logger = new Logger(McpDispatcher.name);

  constructor(
    private readonly registry: McpToolRegistry,
    private readonly limiter: AgentRateLimiter,
    @Inject(VAULT_SETTINGS) private readonly settings: VaultSettingsPort,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
    @Optional() @Inject(VAULT_MCP_OPTIONS) private readonly options?: VaultMcpOptions,
  ) {}

  /** Answers one message; `null` for a notification (the transport answers 202). */
  async dispatch(msg: RpcMessage, rctx: McpRequestContext, caller: McpCaller): Promise<DispatchOutcome | null> {
    const id = msg.id as RpcId | undefined;
    if (id === undefined) return null; // a notification (notifications/initialized, ...): nothing to answer
    const method = typeof msg.method === 'string' ? msg.method : '';
    const { flags } = rctx;
    const ok = (result: Record<string, unknown>, cacheable = false): DispatchOutcome => ({
      status: 200,
      body: rpcResult(id, this.decorate(result, rctx, cacheable)),
    });
    // 2026-07-28 answers an unknown method with HTTP 404; earlier revisions inside a 200.
    const notFound = (message: string, data?: unknown): DispatchOutcome => ({
      status: flags.perRequestMeta ? 404 : 200,
      body: rpcError(id, RPC.METHOD_NOT_FOUND, message, data),
    });

    switch (method) {
      case 'initialize':
        if (!flags.handshake) {
          return notFound(
            `initialize is not part of protocol ${rctx.version}: call server/discover, or send initialize without a 2026-07-28 version. Supported: ${SUPPORTED_VERSIONS.join(', ')}`,
            { supported: [...SUPPORTED_VERSIONS] },
          );
        }
        return ok({
          protocolVersion: negotiateInitialize((msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion),
          capabilities: this.capabilities(),
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        });
      case 'ping':
        if (!flags.handshake) return notFound('Method not found: ping (removed in 2026-07-28)');
        return ok({});
      case 'server/discover':
        return ok({ supportedVersions: [...SUPPORTED_VERSIONS], capabilities: this.capabilities(), instructions: MCP_INSTRUCTIONS }, true);
      case 'tools/list':
        // Every tool is listed with its scope in `securitySchemes`; the scope is enforced at call time.
        return ok({ tools: this.registry.all().map((t) => toolListEntry(t, flags)) }, true);
      case 'tools/call':
        return this.toolsCall(msg, id, rctx, caller, ok);
      default:
        return notFound(`Method not found: ${method.slice(0, 64)}`);
    }
  }

  private capabilities(): Record<string, unknown> {
    return { tools: { listChanged: false } };
  }

  /** 2026-07-28 result fields; earlier revisions get the result unchanged. */
  private decorate(result: Record<string, unknown>, rctx: McpRequestContext, cacheable: boolean): Record<string, unknown> {
    if (!rctx.flags.perRequestMeta) return result;
    return {
      ...result,
      resultType: 'complete',
      ...(cacheable && rctx.flags.listCacheHints ? { ttlMs: LIST_TTL_MS, cacheScope: LIST_CACHE_SCOPE } : {}),
      _meta: { ...((result._meta as Record<string, unknown> | undefined) ?? {}), [META.serverInfo]: MCP_SERVER_INFO },
    };
  }

  private async agentAccess(): Promise<AgentAccessSettings> {
    const stored = await this.settings.getNamespace<Partial<AgentAccessSettings>>('agentAccess');
    return { ...AGENT_ACCESS_SETTINGS_DEFAULTS, ...(stored ?? {}) };
  }

  /**
   * The audit row of one call: who, which tool, the secret id and the outcome. Never an argument or a
   * result. `required` (a success) fails the call closed when the trail cannot be written.
   */
  private async record(
    caller: McpCaller,
    rctx: McpRequestContext,
    tool: string,
    secretId: string | undefined,
    result: string,
    required: boolean,
    field?: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        actorUserId: caller.userId,
        action: MCP_TOOL_CALL_AUDIT_ACTION,
        targetType: secretId ? 'secret' : 'user',
        targetId: secretId ?? caller.userId,
        meta: {
          tool,
          result,
          ...credentialMeta(caller.credential),
          secretId: secretId ?? null,
          // The NAME of the field a reveal returned (never its value).
          ...(field ? { field } : {}),
          ...(rctx.clientInfo ? { mcpClient: rctx.clientInfo.name } : {}),
        },
      });
    } catch (error) {
      this.logger.error(`MCP audit write failed for ${tool}: ${(error as Error).name}`);
      if (required) throw error;
    }
  }

  private async toolsCall(
    msg: RpcMessage,
    id: RpcId,
    rctx: McpRequestContext,
    caller: McpCaller,
    ok: (result: Record<string, unknown>, cacheable?: boolean) => DispatchOutcome,
  ): Promise<DispatchOutcome> {
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = String(params.name ?? '').slice(0, 64);
    const tool = this.registry.get(name);
    if (!tool) return { status: 200, body: rpcError(id, RPC.INVALID_PARAMS, `Unknown tool ${name}`) };

    // Who may call: a step-up or a refusal is an HTTP 403 thrown to the filter (never a result).
    caller.authorize(tool);

    // Defense in depth (#244), independent of `authorize`: an `oat_` token reveals a field only with the
    // reveal scope itself, whatever `authorize` decided.
    if (tool.revealsField && caller.credential?.kind === 'oauth' && !caller.credential.scopes.includes(REVEAL_SCOPE)) {
      throw new InsufficientScopeException({ resourceId: caller.credential.resourceId ?? 'mcp', requiredScopes: [REVEAL_SCOPE] });
    }

    const settings = await this.agentAccess();
    if (!settings.enabled) {
      await this.record(caller, rctx, tool.name, undefined, 'denied:disabled', false);
      return {
        status: 403,
        body: rpcError(id, RPC.DISABLED, 'Agent access is switched off by the administrator', { code: AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED }),
      };
    }

    // `reveal_secret` has its own, stricter bucket (`agentAccess.revealPerMinute`), counted before the lookup.
    const bucket = tool.revealsField ? 'reveal' : 'mcp';
    const perMinute = tool.revealsField ? (settings.revealPerMinute ?? REVEAL_RATE_PER_MINUTE) : (this.options?.ratePerMinute ?? MCP_RATE_PER_MINUTE);
    const decision = this.limiter.consume(`${bucket}:${principalKey(caller.credential)}:${caller.userId}`, perMinute);
    if (!decision.allowed) {
      await this.record(caller, rctx, tool.name, undefined, 'denied:rate_limited', false);
      return {
        status: 429,
        headers: { 'retry-after': String(decision.retryAfterSeconds) },
        body: rpcError(id, RPC.RATE_LIMITED, `Too many requests. Wait ${decision.retryAfterSeconds} seconds.`, {
          code: AGENT_ERROR_CODES.RATE_LIMITED,
          retryAfterS: decision.retryAfterSeconds,
        }),
      };
    }

    const parsed = tool.input.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      await this.record(caller, rctx, tool.name, undefined, 'error:invalid_arguments', false);
      return ok({ ...this.finalize(errorResult(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`), rctx) });
    }

    let result: McpToolResult;
    let secretId: string | undefined;
    let field: string | undefined;
    let outcome = 'ok';
    try {
      const out = await tool.handler(parsed.data, { userId: caller.userId, permissions: caller.permissions });
      secretId = out.secretId;
      field = out.field;
      // Fail closed: a result that carries a value it must not is withheld whole. Only a tool that
      // declares `revealsField` is let off, and only for the one `value` key of its result (#244).
      assertNoSensitiveValues(out.data, out.sensitive ?? [], tool.revealsField ? { key: 'value' } : undefined);
      result = structuredResult(out.data, out.summary);
    } catch (error) {
      if (error instanceof McpRedactionError) {
        outcome = 'error:redaction';
        result = errorResult('The result was withheld because it would have exposed a secret value.', 'REDACTION_BLOCKED');
      } else if (error instanceof McpToolError) {
        outcome = `error:${error.code.toLowerCase()}`;
        secretId = error.secretId;
        result = errorResult(error.message, error.code);
      } else if (error instanceof NotFoundException) {
        outcome = 'error:not_found';
        result = errorResult('No secret with that id is available to this connection. Use search_secrets to find one.', 'NOT_FOUND');
      } else if (error instanceof HttpException) {
        const status = error.getStatus();
        outcome = `error:http_${status}`;
        result = errorResult(this.httpMessage(error), status === 409 ? 'CONFLICT' : status === 400 || status === 422 ? 'INVALID_ARGUMENTS' : 'FAILED');
      } else {
        outcome = 'error:failed';
        // The name only: a message could quote a value.
        this.logger.error(`MCP tool ${tool.name} failed: ${(error as Error)?.name ?? 'Error'}`);
        result = errorResult(`${tool.name} failed. Try again later.`, 'TOOL_FAILED');
      }
    }

    try {
      await this.record(caller, rctx, tool.name, secretId, outcome, outcome === 'ok', field);
    } catch {
      return ok({ ...this.finalize(errorResult('The call could not be recorded in the audit trail, so its result was withheld.', 'AUDIT_UNAVAILABLE'), rctx) });
    }
    return ok({ ...this.finalize(result, rctx) });
  }

  /** The sentence of an HTTP exception a service threw: only the validation errors and fixed text, never a body. */
  private httpMessage(error: HttpException): string {
    const status = error.getStatus();
    const body = error.getResponse();
    const details = typeof body === 'object' && body !== null ? (body as { details?: { errors?: unknown } }).details : undefined;
    if (status === 400 && Array.isArray(details?.errors)) return `Invalid arguments: ${details.errors.map(String).join('; ')}`;
    if (status === 409) return 'A secret with that name already exists. Choose another name.';
    if (status === 400 || status === 422) return 'Invalid arguments.';
    return `The request failed (${status}).`;
  }

  /** Drops `structuredContent` for revisions that do not have it. */
  private finalize(result: McpToolResult, rctx: McpRequestContext): McpToolResult {
    if (rctx.flags.structuredContent) return result;
    const { structuredContent: _dropped, ...rest } = result;
    return rest;
  }
}
