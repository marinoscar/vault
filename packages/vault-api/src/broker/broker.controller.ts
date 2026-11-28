import { applyDecorators, Controller, Delete, ForbiddenException, Get, Options, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@marinoscar/platform-api/identity';
import { BROKER_ERROR_CODES } from '@marinoscar/vault-contract/broker';
import type { FastifyReply } from 'fastify';

import { BROKER_CALLER_KEY, BrokerAuthGuard, type BrokerRequest } from './broker-auth.guard';
import { BrokerForwardService } from './broker-forward.service';
import type { BrokerRawRequest } from './broker-raw-body';
import { BROKER_RAW_CONTENT_TYPE } from './broker-raw-body';

/** Methods the broker forwards. */
const FORWARDED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** `/<prefix>/broker/v1/<secretId>/<host>[/<rest>][?<query>]`, read from the raw URL so the path and query are forwarded as sent. */
const FORWARD_URL = /\/broker\/v1\/[^/?]+\/[^/?]+(\/[^?]*)?(?:\?(.*))?$/;

/** The OpenAPI documentation every forwarded method shares (one documented operation per method, never the all-methods expansion that emits a non-OAS `search`). */
const FORWARD_DOCS = [
  ApiOperation({
    summary: 'Use a stored key against an allowed upstream (credential broker)',
    description:
      'Forwards the request to `https://{upstreamHost}/{rest}?{query}` with the secret\'s key added as the owner configured ' +
      '(`Authorization: Bearer <key>` by default, any other header or a query parameter), and returns the upstream\'s response as is ' +
      '(status, filtered headers, body; NOT the `{ data }` envelope) plus `X-Vault-Broker: 1`. The key is never returned: a response that contains it is withheld (502 BROKER_KEY_ECHO). ' +
      'Authenticate with a broker token (`vbk_`, valid only on this path) or a personal access token (`pat_`); an OAuth token or a session is refused (403 BROKER_CREDENTIAL_REFUSED). ' +
      'Checks, in order: credential, kill switches (403 BROKER_DISABLED), rate limit (429 RATE_LIMITED), token restriction, the secret is yours with the broker on (one identical 404), ' +
      'the origin equals an allowed origin exactly (403 BROKER_ORIGIN_MISMATCH), request size (413), DNS (403 BROKER_DESTINATION_BLOCKED when any address is private), then the key is decrypted. ' +
      'Redirects are never followed. Caps and the time limit come from the `agentAccess.broker` settings (502 BROKER_RESPONSE_TOO_LARGE, 504 BROKER_UPSTREAM_TIMEOUT, 502 BROKER_UPSTREAM_ERROR). ' +
      'Every call is audited as broker.forward (never the key, body, query or headers). Methods GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.',
  }),
  ApiParam({ name: 'secretId', type: String, format: 'uuid', description: 'The secret whose key is used' }),
  ApiParam({ name: 'upstreamHost', type: String, description: 'The allowed upstream `host[:port]` (HTTPS only)' }),
  ApiResponse({ status: 200, description: 'The upstream response, whatever its status, with X-Vault-Broker: 1' }),
  ApiResponse({ status: 401, description: 'No or an invalid, revoked or expired broker or personal access token' }),
  ApiResponse({ status: 403, description: 'BROKER_CREDENTIAL_REFUSED, BROKER_DISABLED, BROKER_ORIGIN_MISMATCH or BROKER_DESTINATION_BLOCKED' }),
  ApiResponse({ status: 404, description: 'The secret is not yours, has the broker off, is not usable or is outside the token\'s restriction' }),
  ApiResponse({ status: 413, description: 'BROKER_REQUEST_TOO_LARGE' }),
  ApiResponse({ status: 422, description: 'BROKER_KEY_MISSING' }),
  ApiResponse({ status: 429, description: 'RATE_LIMITED (see Retry-After)' }),
  ApiResponse({ status: 502, description: 'BROKER_UPSTREAM_ERROR, BROKER_RESPONSE_TOO_LARGE or BROKER_KEY_ECHO' }),
  ApiResponse({ status: 504, description: 'BROKER_UPSTREAM_TIMEOUT' }),
];

const WILDCARD_PARAM = ApiParam({ name: 'path', type: String, required: true, description: 'The rest of the upstream path (the URL remainder after the host; may be empty or contain slashes)' });

/** The documentation of the wildcard route (`:secretId/:upstreamHost/*`). */
const wildcardDocs = (): MethodDecorator => applyDecorators(...FORWARD_DOCS, WILDCARD_PARAM);
/** The documentation of the root route (`:secretId/:upstreamHost`). */
const rootDocs = (): MethodDecorator =>
  applyDecorators(
    ApiOperation({ summary: 'Use a stored key against the root of an allowed upstream', description: 'The same as `/api/broker/v1/:secretId/:upstreamHost/*` with an empty path.' }),
    ApiParam({ name: 'secretId', type: String, format: 'uuid' }),
    ApiParam({ name: 'upstreamHost', type: String }),
    ApiResponse({ status: 200, description: 'The upstream response' }),
  );

/**
 * The credential broker's forwarding endpoint (issue #246, ADR-0006): `ALL
 * /api/broker/v1/:secretId/:upstreamHost/*` sends the request, with the secret's key added, to
 * `https://{upstreamHost}/{rest}?{query}` and returns the upstream's raw response (not the `{ data }`
 * envelope, like the export zip).
 *
 * Authentication is `BrokerAuthGuard` (`@Public()` to the platform): a `vbk_` or `pat_` token, nothing
 * else. Everything after that is `BrokerForwardService`.
 *
 * @stability experimental
 */
@ApiTags('Broker')
@Controller('broker/v1')
@Public()
@UseGuards(BrokerAuthGuard)
export class BrokerController {
  constructor(private readonly forwarder: BrokerForwardService) {}

  // One handler per forwarded method (not `@All`): `@All` makes the OpenAPI generator emit a non-standard `search`
  // operation, and these are the methods `handle` forwards. HEAD is not declared: Fastify exposes it from each GET route and `handle` still sees `HEAD`.
  @Get(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardGet(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Get(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootGet(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Post(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardPost(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Post(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootPost(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Put(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardPut(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Put(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootPut(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Patch(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardPatch(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Patch(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootPatch(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Delete(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardDelete(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Delete(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootDelete(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Options(':secretId/:upstreamHost/*')
  @wildcardDocs()
  async forwardOptions(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  @Options(':secretId/:upstreamHost')
  @rootDocs()
  async forwardRootOptions(@Req() req: BrokerRequest, @Res() reply: FastifyReply, @Param('secretId') secretId: string, @Param('upstreamHost') upstreamHost: string): Promise<void> {
    return this.handle(req, reply, secretId, upstreamHost);
  }

  private async handle(req: BrokerRequest, reply: FastifyReply, secretId: string, upstreamHost: string): Promise<void> {
    const caller = req[BROKER_CALLER_KEY];
    if (!caller) throw new ForbiddenException({ code: BROKER_ERROR_CODES.BROKER_CREDENTIAL_REFUSED, message: 'The broker accepts only a broker token or a personal access token' });
    const method = req.method.toUpperCase();
    if (!FORWARDED_METHODS.has(method)) {
      void reply.status(405).header('allow', [...FORWARDED_METHODS].join(', ')).send({ statusCode: 405, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
      return;
    }
    const match = FORWARD_URL.exec(req.raw.url ?? '');
    const path = match?.[1] && match[1] !== '' ? match[1] : '/';
    const query = match?.[2] ?? '';

    // The raw-body hook swapped the content type to read the body untouched; the forward sees the original.
    const headers = { ...req.headers };
    const original = (req as unknown as BrokerRawRequest).brokerContentType;
    if (headers['content-type'] === BROKER_RAW_CONTENT_TYPE) {
      if (original === undefined) delete headers['content-type'];
      else headers['content-type'] = original;
    }

    try {
      const result = await this.forwarder.forward({
        caller,
        secretId,
        upstreamHost,
        path,
        query,
        method,
        headers,
        body: req.body,
      });
      void reply.status(result.status);
      for (const [name, value] of Object.entries(result.headers)) void reply.header(name, value);
      void reply.send(method === 'HEAD' ? undefined : result.body);
    } catch (error) {
      // An unread upload would hold the connection open: close it after the refusal.
      if (req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined) void reply.header('connection', 'close');
      throw error;
    }
  }
}
