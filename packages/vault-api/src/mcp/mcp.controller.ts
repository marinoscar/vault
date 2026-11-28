// =============================================================================
// POST /api/mcp: the Vault MCP server over Streamable HTTP (issue #180, E14.8, epic #172)
// =============================================================================
//
// Stateless: one JSON-RPC request in, one JSON response out; no session, no SSE stream. `GET` and
// `DELETE` (authenticated like every route: none is public) answer 405: there is no stream to open
// and no session to end. The route is the `mcp` OAuth protected resource (`mcp-oauth.ts`): an `oat_`
// token confined to `/api/mcp`, a `pat_` token or a session bearer are accepted too (a session is
// harmless here: it is the user's own Bearer JWT, and the tools give a session nothing an `oat_`
// token with the same permissions would not get).
//
// Order of checks: the Origin rule (before authentication: a browser page of another origin never gets
// as far as a 401 body), authentication and `secrets:read` (`@Auth`), the transport rules (batch,
// version, headers), then per tool the scope step-up (HTTP 403), the kill switch (HTTP 403), the rate
// limit (HTTP 429), validation and the handler (`mcp-dispatcher.ts`).
//
// The response is the JSON-RPC body itself (`@RawResponse()`): never the `{ data }` envelope.
// =============================================================================

import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Optional,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RawResponse } from '@marinoscar/platform-api/core';
import {
  Auth,
  InsufficientScopeException,
  authCredentialOf,
  oauthAccessDecision,
  principalOf,
  type RequestWithAuthCredential,
} from '@marinoscar/platform-api/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { PERMISSIONS } from '../core/roles.constants';
import { McpDispatcher, type McpCaller } from './mcp-dispatcher';
import { VAULT_MCP_RESOURCE_ID } from './mcp-oauth';
import { VAULT_MCP_OPTIONS, type VaultMcpOptions } from './mcp-options';
import {
  MCP_VERSIONS,
  McpProtocolError,
  isAllowedOrigin,
  requestContext,
  resolveVersion,
  type McpHeaders,
  type RpcMessage,
} from './protocol/mcp-protocol';
import { RPC, rpcError, type RpcId, type RpcResponse } from './protocol/mcp-rpc';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The Origin rule: a request carrying an `Origin` that is not the application's own (or an extra
 * origin the host allowed) is refused with 403, before authentication. Absent `Origin`: passes.
 */
@Injectable()
export class McpOriginGuard implements CanActivate {
  constructor(@Optional() @Inject(VAULT_MCP_OPTIONS) private readonly options?: VaultMcpOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const origin = header(req, 'origin');
    if (origin === undefined) return true;
    if (isAllowedOrigin(origin, this.options?.appUrl, this.options?.allowedOrigins)) return true;
    throw new ForbiddenException('This origin is not allowed to call the MCP endpoint');
  }
}

/** A message's id when it is a valid JSON-RPC id (string, number or null). */
function idOf(msg: RpcMessage): RpcId | undefined {
  const id = msg.id;
  if (id === undefined) return undefined;
  return typeof id === 'string' || typeof id === 'number' || id === null ? id : undefined;
}

/** `-32600` for a message that is not a JSON-RPC 2.0 request or notification; `null` when it is one. */
function invalid(msg: unknown): RpcResponse | null {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: a JSON-RPC message is an object');
  const m = msg as RpcMessage;
  const id = idOf(m) ?? null;
  if (m.jsonrpc !== '2.0') return rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
  if (m.id !== undefined && idOf(m) === undefined) return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: id must be a string, a number or null');
  if (typeof m.method !== 'string' || m.method === '') return rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: method is required');
  if (m.params !== undefined && (m.params === null || typeof m.params !== 'object' || Array.isArray(m.params))) {
    return rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: params must be an object');
  }
  return null;
}

/**
 * The Model Context Protocol endpoint of Vault. Contract: docs/API.md ("MCP"). The tools are
 * `vault-mcp-tools.ts`; only `reveal_secret` (scope `vault:mcp_reveal`, #244) returns a secret value: one field of a secret the owner opted in.
 *
 * @stability experimental
 */
@ApiTags('MCP')
@Controller('mcp')
export class McpController {
  constructor(private readonly dispatcher: McpDispatcher) {}

  @Post()
  @HttpCode(200)
  @RawResponse()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  // Listed AFTER `@Auth` in source order = applied first = runs first: the Origin rule precedes authentication.
  @UseGuards(McpOriginGuard)
  @ApiOperation({
    summary: 'Model Context Protocol endpoint (JSON-RPC 2.0 over Streamable HTTP)',
    description:
      'One JSON-RPC request per POST: initialize, notifications/initialized (202), ping, tools/list, tools/call. ' +
      'Batches are refused (400). Protocol revisions 2024-11-05 to 2026-07-28 (MCP-Protocol-Version). ' +
      'Authenticate with an OAuth `oat_` token for the `mcp` resource (scopes vault:mcp_read, vault:mcp_write, vault:mcp_reveal), a `pat_` token or a session bearer. ' +
      'A tools/call whose scope the token lacks answers 403 insufficient_scope (step-up); with agentAccess.enabled off, 403 AGENT_ACCESS_DISABLED; ' +
      'over 60 calls per minute per grant (reveal_secret: agentAccess.revealPerMinute, default 10), 429 with Retry-After. Tools: search_secrets, get_secret, list_secret_types, create_secret, update_secret, reveal_secret. ' +
      'Only reveal_secret returns a secret value (one field of a secret the owner switched "Reveal to assistants" on for; every read is audited). The response is the JSON-RPC body, not the `{ data }` envelope.',
  })
  @ApiResponse({ status: 200, description: 'A JSON-RPC response (result or error)' })
  @ApiResponse({ status: 202, description: 'A notification was accepted' })
  @ApiResponse({ status: 400, description: 'Batch, invalid JSON-RPC, unsupported protocol version or header mismatch' })
  @ApiResponse({ status: 401, description: 'Missing or invalid credential (WWW-Authenticate challenge)' })
  @ApiResponse({ status: 403, description: 'Origin not allowed, insufficient_scope (step-up), AGENT_ACCESS_DISABLED, or the user lacks the permission' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' })
  async post(@Req() req: FastifyRequest, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<RpcResponse | undefined> {
    const send = (status: number, payload: RpcResponse, headers: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(headers)) void reply.header(k, v);
      void reply.code(status);
      return payload;
    };

    const credential = authCredentialOf(req as FastifyRequest & RequestWithAuthCredential);
    const principal = principalOf(req as never);
    const headers: McpHeaders = {
      protocolVersion: header(req, 'mcp-protocol-version'),
      method: header(req, 'mcp-method'),
      name: header(req, 'mcp-name'),
    };

    if (Array.isArray(body)) {
      // Batches exist in 2025-03-26 only, and this server refuses them on every revision: one request, one answer.
      try {
        const version = resolveVersion({ protocolVersion: headers.protocolVersion }, {});
        const detail = MCP_VERSIONS[version].batching ? 'this server does not accept batches' : `JSON-RPC batches are not part of protocol ${version}`;
        return send(400, rpcError(null, RPC.INVALID_REQUEST, `Invalid Request: ${detail}; send one request per POST`));
      } catch (e) {
        if (e instanceof McpProtocolError) return send(e.httpStatus, rpcError(null, e.code, e.message, e.data));
        throw e;
      }
    }

    const bad = invalid(body);
    if (bad) return send(400, bad);
    const msg = body as RpcMessage;

    let rctx;
    try {
      rctx = requestContext(headers, msg, credential);
    } catch (e) {
      if (e instanceof McpProtocolError) return send(e.httpStatus, rpcError(idOf(msg) ?? null, e.code, e.message, e.data));
      throw e;
    }

    const userId = principal?.userId ?? (req as FastifyRequest & { user?: { id?: string } }).user?.id ?? '';
    const caller: McpCaller = {
      userId,
      permissions: principal?.permissions ?? [],
      credential,
      authorize: (tool) => {
        const decision = oauthAccessDecision(req, tool.permission);
        // The token lacks the scope but the user holds the permission: re-consent can fix it (HTTP 403 + challenge).
        if (decision === 'step_up') throw new InsufficientScopeException({ resourceId: VAULT_MCP_RESOURCE_ID, requiredScopes: [tool.scope] });
        // The user lacks the permission: no consent can help.
        if (decision === 'forbidden') throw new ForbiddenException('Your account is not allowed to use this tool');
      },
    };

    const out = await this.dispatcher.dispatch(msg, rctx, caller);
    if (out === null) {
      void reply.code(202);
      return undefined;
    }
    return send(out.status, out.body, out.headers);
  }

  /** No server-initiated stream (stateless server). */
  @Get()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @RawResponse()
  @ApiOperation({ summary: 'MCP stream (not offered)', description: 'The server has no server-initiated stream: 405 with `Allow: POST`.' })
  @ApiResponse({ status: 405, description: 'Method not allowed' })
  get(@Res({ passthrough: true }) reply: FastifyReply): RpcResponse {
    void reply.code(405).header('allow', 'POST');
    return rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed: the MCP endpoint accepts POST only (no server-initiated stream, no sessions)');
  }

  /** No sessions to end. */
  @Delete()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @RawResponse()
  @ApiOperation({ summary: 'MCP session end (not offered)', description: 'The server has no sessions: 405 with `Allow: POST`.' })
  @ApiResponse({ status: 405, description: 'Method not allowed' })
  end(@Res({ passthrough: true }) reply: FastifyReply): RpcResponse {
    void reply.code(405).header('allow', 'POST');
    return rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed: the MCP endpoint accepts POST only (no server-initiated stream, no sessions)');
  }
}
