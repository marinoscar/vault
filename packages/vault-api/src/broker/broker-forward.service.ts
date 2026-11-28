// =============================================================================
// The credential broker's forward pipeline (issue #246, ADR-0006)
// =============================================================================
//
// An agent calls Vault; Vault adds the owner's key server-side and forwards the request to an
// upstream origin the owner allowed. The key never leaves this process except in the one request to
// that origin, and never appears in a response, a log line, a span or an audit row.
//
// THE ORDER OF CHECKS IS PART OF THE DESIGN (ADR-0006 decision 7; fail closed, each step before the
// next costs anything, nothing decrypted until the last):
//
//   1. the credential kind (`vbk_` or `pat_`)                    BrokerAuthGuard, before this service
//   2. agentAccess.enabled AND agentAccess.broker.enabled        403 BROKER_DISABLED
//   3. the rate limit, per token and user                        429 RATE_LIMITED + Retry-After
//   4. the token's secret restriction                            404 (identical to every 404 below)
//   5. the secret: the caller's own, brokerAccess on, a supported type, a valid injection  404
//   6. the origin: https://{upstreamHost} equals one allowed origin exactly   403 BROKER_ORIGIN_MISMATCH
//   7. the request size announced by Content-Length              413 BROKER_REQUEST_TOO_LARGE
//   8. DNS, once; ANY blocked address refuses the call           403 BROKER_DESTINATION_BLOCKED
//   9. decrypt the one field of the current version              422 BROKER_KEY_MISSING
//  10. send, pinned to the validated address, TLS verified, no redirects, capped and timed
//  11. the response, decoded and scanned for the key: body and every header   502 BROKER_KEY_ECHO
//
// One audit row (`broker.forward`) per call, allowed or refused: ids, origin, method, the path
// WITHOUT its query string, status, byte counts, duration and outcome. Never the key, a body, the
// query or a header.
// =============================================================================

import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isBlockedAddress, withResponseHeaders } from '@marinoscar/platform-api/core';
import { brotliDecompress, gunzip, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import { Readable, Transform, pipeline } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import { resolveAgentAccessSettings, AGENT_ERROR_CODES } from '@marinoscar/vault-contract/agent';
import {
  BROKER_ERROR_CODES,
  BROKER_FORWARD_AUDIT_ACTION,
  BROKER_RESPONSE_HEADER,
  DEFAULT_BROKER_INJECTION,
  brokerInjectionSchema,
  type BrokerInjection,
} from '@marinoscar/vault-contract/broker';

import { AgentRateLimiter } from '../agent/agent-rate-limiter';
import {
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_PRISMA,
  VAULT_SETTINGS,
  type VaultAuditPort,
  type VaultCryptoPort,
  type VaultPrismaClient,
  type VaultSettingsPort,
} from '../ports';
import { applyInjection, containsKey, echoNeedles, filterRequestHeaders, filterResponseHeaders, type BrokerHeaders } from './broker-http';
import { originOfUpstreamHost } from './broker-origin';
import { resolveBrokerField } from './broker-types';
import { BrokerResolver, BrokerUpstream, BrokerUpstreamFailure } from './broker-upstream';

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The injection token of {@link BrokerForwardOptions}; only tests provide it. */
export const BROKER_FORWARD_OPTIONS = Symbol.for('@marinoscar/vault/BROKER_FORWARD_OPTIONS');

/**
 * Constructor options of the forward service. They exist so a test can run against a local HTTPS
 * server. NOTHING in the package reads an environment variable to turn one on, the token is NOT
 * exported from the package's public entry points (only from `@marinoscar/vault-api/testing`), and
 * no module of the package or of the host binds it: only a test's `Test.createTestingModule` does.
 * `apps/api/test/broker/broker-confinement.spec.ts` proves the production module graph has no binding.
 */
export interface BrokerForwardOptions {
  /** Test only: do not refuse loopback addresses (127.0.0.0/8, ::1). Every other blocked range stays blocked. */
  allowLoopbackForTests?: boolean;
}

/** The caller of a forward: a broker token or a personal access token, and what it may reach. */
export interface BrokerCaller {
  kind: 'broker' | 'pat';
  userId: string;
  /** The `broker_tokens` or `personal_access_tokens` id (never the token). */
  tokenId: string;
  /** A broker token's restriction; empty means every broker-enabled secret of the owner. */
  secretIds: string[];
}

/** One forward request, as the controller parsed it. */
export interface BrokerForwardRequest {
  caller: BrokerCaller;
  secretId: string;
  /** The `:upstreamHost` path segment, as sent. */
  upstreamHost: string;
  /** The path after the host, starting with `/` (just `/` when empty). */
  path: string;
  /** The query string without `?`. */
  query: string;
  method: string;
  headers: IncomingHttpHeaders;
  /** The request body: a stream (the raw-body hook), a buffer, or nothing. */
  body: unknown;
}

/** The raw upstream response handed back to the caller. */
export interface BrokerForwardResponse {
  status: number;
  headers: BrokerHeaders;
  body: Buffer;
}

class BodyTooLarge extends Error {}

class ByteLimit extends Transform {
  count = 0;
  constructor(private readonly limit: number) {
    super();
  }
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.count += chunk.length;
    if (this.count > this.limit) callback(new BodyTooLarge());
    else callback(null, chunk);
  }
}

interface AuditCtx {
  secretId?: string;
  origin?: string;
  path?: string;
  method: string;
  status?: number;
  requestBytes: number;
  responseBytes: number;
}

/** The headers a refusal can carry (Retry-After). */
function refusal(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

@Injectable()
export class BrokerForwardService {
  private readonly logger = new Logger(BrokerForwardService.name);
  private readonly allowLoopback: boolean;

  /** The clock; a test replaces it. */
  now: () => number = () => Date.now();

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
    @Inject(VAULT_SETTINGS) private readonly settings: VaultSettingsPort,
    @Inject(VAULT_AUDIT) private readonly audit: VaultAuditPort,
    private readonly limiter: AgentRateLimiter,
    private readonly resolver: BrokerResolver,
    private readonly upstream: BrokerUpstream,
    @Optional() @Inject(BROKER_FORWARD_OPTIONS) options?: BrokerForwardOptions,
  ) {
    this.allowLoopback = options?.allowLoopbackForTests === true;
  }

  /** Runs one forward (see the header for the order). Audits exactly once. */
  async forward(req: BrokerForwardRequest): Promise<BrokerForwardResponse> {
    const started = this.now();
    const ctx: AuditCtx = { method: req.method, requestBytes: 0, responseBytes: 0, ...(UUID.test(req.secretId) ? { secretId: req.secretId } : {}) };
    let result: BrokerForwardResponse;
    try {
      result = await this.run(req, ctx);
    } catch (error) {
      const { outcome, reason } = this.classify(error);
      await this.writeAudit(req, ctx, started, outcome, reason).catch((auditError: unknown) =>
        this.logger.error(`Broker audit write failed: ${(auditError as Error)?.name}`),
      );
      throw error;
    }
    // A success is audited BEFORE the response is returned: an unwritable trail fails the call closed.
    await this.writeAudit(req, ctx, started, 'forwarded', null);
    return result;
  }

  // ---------------------------------------------------------------------------

  private async run(req: BrokerForwardRequest, ctx: AuditCtx): Promise<BrokerForwardResponse> {
    const { caller } = req;
    ctx.path = req.path.length > 512 ? `${req.path.slice(0, 512)}...` : req.path;

    // 2. kill switches
    const settings = resolveAgentAccessSettings(await this.settings.getNamespace<unknown>('agentAccess'));
    const broker = settings.broker!;
    if (!settings.enabled || !broker.enabled) {
      throw refusal(HttpStatus.FORBIDDEN, BROKER_ERROR_CODES.BROKER_DISABLED, 'The credential broker is switched off');
    }

    // 3. rate limit (before anything is looked up)
    const decision = this.limiter.consume(`broker:${caller.kind}:${caller.tokenId}:${caller.userId}`, broker.forwardsPerMinute);
    if (!decision.allowed) {
      throw withResponseHeaders(
        new HttpException({ code: AGENT_ERROR_CODES.RATE_LIMITED, message: 'Too many broker requests; retry later' }, HttpStatus.TOO_MANY_REQUESTS),
        { 'Retry-After': String(decision.retryAfterSeconds) },
      );
    }

    // 4 and 5. restriction, then the secret: ONE identical 404 for every way it can be unavailable
    const notFound = (): NotFoundException => new NotFoundException('Secret not found');
    if (!UUID.test(req.secretId)) throw notFound();
    if (caller.secretIds.length > 0 && !caller.secretIds.includes(req.secretId)) throw notFound();
    const secret = await this.prisma.secret.findFirst({
      where: { id: req.secretId, createdById: caller.userId, brokerAccess: true },
      include: { type: true },
    });
    if (!secret) throw notFound();
    const resolved = resolveBrokerField(secret.type as never, secret.brokerField);
    if (!resolved.ok) throw notFound();
    let injection: BrokerInjection = DEFAULT_BROKER_INJECTION;
    if (secret.brokerInjection !== null && secret.brokerInjection !== undefined) {
      const parsed = brokerInjectionSchema.safeParse(secret.brokerInjection);
      if (!parsed.success) throw notFound();
      injection = parsed.data;
    }

    // 6. the origin, exactly
    const origin = originOfUpstreamHost(req.upstreamHost);
    if (origin?.ok) ctx.origin = origin.origin;
    if (!origin || !origin.ok || !(secret.brokerOrigins ?? []).includes(origin.origin)) {
      throw refusal(HttpStatus.FORBIDDEN, BROKER_ERROR_CODES.BROKER_ORIGIN_MISMATCH, 'This origin is not allowed for this secret');
    }

    // 7. the announced request size
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > broker.maxRequestBytes) {
      throw new PayloadTooLargeException({ code: BROKER_ERROR_CODES.BROKER_REQUEST_TOO_LARGE, message: 'The request body is too large' });
    }

    // 8. DNS once; every address must be public
    let addresses;
    try {
      addresses = await this.resolveWithin(origin.hostname, broker.timeoutMs);
    } catch (error) {
      if (error instanceof BrokerUpstreamFailure && error.code === 'timeout') throw this.timeout();
      throw this.upstreamError();
    }
    if (addresses.length === 0) throw this.upstreamError();
    const blocked = addresses.some((a) => !(this.allowLoopback && this.isLoopback(a.address)) && isBlockedAddress(a.address));
    if (blocked) {
      throw refusal(HttpStatus.FORBIDDEN, BROKER_ERROR_CODES.BROKER_DESTINATION_BLOCKED, 'The destination is not reachable through the broker');
    }

    // 9. only now decrypt the one field
    const key = await this.readKey(secret.id, resolved.field);

    // 10. build and send
    const injectedRequest = applyInjection(
      injection,
      key,
      { ...filterRequestHeaders(req.headers), 'accept-encoding': 'identity' },
      req.query,
    );
    const body = this.requestBody(req, broker.maxRequestBytes);
    const headers = { ...injectedRequest.headers };
    if (body.stream && Number.isInteger(declared) && declared > 0) headers['content-length'] = String(declared);

    let upstreamResponse;
    try {
      upstreamResponse = await this.upstream.send({
        hostname: origin.hostname,
        port: origin.port,
        address: addresses[0]!.address,
        family: addresses[0]!.family,
        method: req.method,
        path: `${req.path}${injectedRequest.query ? `?${injectedRequest.query}` : ''}`,
        headers,
        body: body.stream,
        timeoutMs: broker.timeoutMs,
        maxResponseBytes: broker.maxResponseBytes,
      });
    } catch (error) {
      ctx.requestBytes = body.counted();
      if (error instanceof BodyTooLarge) {
        throw new PayloadTooLargeException({ code: BROKER_ERROR_CODES.BROKER_REQUEST_TOO_LARGE, message: 'The request body is too large' });
      }
      if (error instanceof BrokerUpstreamFailure) {
        if (error.code === 'timeout') throw this.timeout();
        if (error.code === 'too_large') throw this.responseTooLarge();
      }
      throw this.upstreamError();
    }
    ctx.requestBytes = body.counted();
    ctx.status = upstreamResponse.status;

    // 11. decode, scan, filter
    const decoded = await this.decode(req.method, upstreamResponse.headers, upstreamResponse.body, broker.maxResponseBytes);
    ctx.responseBytes = decoded.length;
    if (containsKey(echoNeedles(key, injectedRequest.injected), upstreamResponse.headers, decoded)) {
      // The response is withheld whole; only the fact is recorded.
      ctx.status = upstreamResponse.status;
      throw new BadGatewayException({ code: BROKER_ERROR_CODES.BROKER_KEY_ECHO, message: 'The upstream response contained the key and was withheld' });
    }
    return {
      status: upstreamResponse.status,
      headers: { ...filterResponseHeaders(upstreamResponse.headers), [BROKER_RESPONSE_HEADER]: '1' },
      body: decoded,
    };
  }

  // ---------------------------------------------------------------------------

  private isLoopback(address: string): boolean {
    return address === '::1' || /^127\./.test(address) || address === '::ffff:127.0.0.1';
  }

  private timeout(): GatewayTimeoutException {
    return new GatewayTimeoutException({ code: BROKER_ERROR_CODES.BROKER_UPSTREAM_TIMEOUT, message: 'The upstream did not answer in time' });
  }

  private upstreamError(): BadGatewayException {
    return new BadGatewayException({ code: BROKER_ERROR_CODES.BROKER_UPSTREAM_ERROR, message: 'The upstream could not be reached' });
  }

  private responseTooLarge(): BadGatewayException {
    return new BadGatewayException({ code: BROKER_ERROR_CODES.BROKER_RESPONSE_TOO_LARGE, message: 'The upstream response is too large' });
  }

  private async resolveWithin(hostname: string, timeoutMs: number) {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BrokerUpstreamFailure('timeout')), timeoutMs);
    });
    try {
      return await Promise.race([this.resolver.resolveAll(hostname), limit]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The one field of the current version, decrypted. Never logged, never returned. */
  private async readKey(secretId: string, field: string): Promise<string> {
    const version = await this.prisma.secretVersion.findFirst({ where: { secretId, isCurrent: true } });
    if (!version) throw new NotFoundException('Secret not found');
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(this.crypto.decrypt(version.encryptedData, version.iv, version.authTag)) as Record<string, unknown>;
    } catch {
      throw new UnprocessableEntityException({ code: BROKER_ERROR_CODES.BROKER_KEY_MISSING, message: 'The secret value could not be read' });
    }
    const value = values[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new UnprocessableEntityException({ code: BROKER_ERROR_CODES.BROKER_KEY_MISSING, message: 'The secret has no value in the field the broker uses' });
    }
    // A header value cannot hold line breaks (response splitting); a key that does is unusable.
    if (/[\r\n\0]/.test(value)) {
      throw new UnprocessableEntityException({ code: BROKER_ERROR_CODES.BROKER_KEY_MISSING, message: 'The key contains characters that cannot be sent' });
    }
    return value;
  }

  /** The body as a counted, capped stream (or none), and a way to read the byte count. */
  private requestBody(req: BrokerForwardRequest, max: number): { stream: Readable | null; counted: () => number } {
    const source = req.body;
    let input: Readable | null = null;
    if (source instanceof Readable) input = source;
    else if (Buffer.isBuffer(source) || typeof source === 'string') input = Readable.from([Buffer.from(source)]);
    else if (source !== undefined && source !== null && typeof source === 'object') input = Readable.from([Buffer.from(JSON.stringify(source))]);
    if (!input || ['GET', 'HEAD'].includes(req.method)) {
      if (input) input.resume();
      return { stream: null, counted: () => 0 };
    }
    const limiter = new ByteLimit(max);
    pipeline(input, limiter, () => undefined);
    return { stream: limiter, counted: () => limiter.count };
  }

  private async decode(method: string, headers: IncomingHttpHeaders, raw: Buffer, max: number): Promise<Buffer> {
    const encoding = String(headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (method === 'HEAD' || raw.length === 0 || encoding === 'identity' || encoding === '') return raw;
    try {
      const options = { maxOutputLength: max };
      if (encoding === 'gzip' || encoding === 'x-gzip') return await gunzipAsync(raw, options);
      if (encoding === 'deflate') return await inflateAsync(raw, options);
      if (encoding === 'br') return await brotliAsync(raw, options);
    } catch (error) {
      if ((error as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE') throw this.responseTooLarge();
      throw this.upstreamError();
    }
    // An encoding that cannot be decoded cannot be scanned: fail closed.
    throw this.upstreamError();
  }

  private classify(error: unknown): { outcome: 'denied' | 'failed'; reason: string } {
    if (!(error instanceof HttpException)) return { outcome: 'failed', reason: 'error' };
    const body = error.getResponse();
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    const reasons: Record<string, string> = {
      [BROKER_ERROR_CODES.BROKER_DISABLED]: 'disabled',
      [AGENT_ERROR_CODES.RATE_LIMITED]: 'rate_limited',
      [BROKER_ERROR_CODES.BROKER_ORIGIN_MISMATCH]: 'origin_mismatch',
      [BROKER_ERROR_CODES.BROKER_DESTINATION_BLOCKED]: 'destination_blocked',
      [BROKER_ERROR_CODES.BROKER_REQUEST_TOO_LARGE]: 'request_too_large',
      [BROKER_ERROR_CODES.BROKER_KEY_MISSING]: 'key_missing',
      [BROKER_ERROR_CODES.BROKER_KEY_ECHO]: 'key_echo',
      [BROKER_ERROR_CODES.BROKER_RESPONSE_TOO_LARGE]: 'response_too_large',
      [BROKER_ERROR_CODES.BROKER_UPSTREAM_TIMEOUT]: 'upstream_timeout',
      [BROKER_ERROR_CODES.BROKER_UPSTREAM_ERROR]: 'upstream_error',
    };
    if (typeof code === 'string' && reasons[code]) {
      const failed = code === BROKER_ERROR_CODES.BROKER_UPSTREAM_TIMEOUT || code === BROKER_ERROR_CODES.BROKER_UPSTREAM_ERROR;
      return { outcome: failed ? 'failed' : 'denied', reason: reasons[code]! };
    }
    return { outcome: 'denied', reason: error.getStatus() === 404 ? 'not_found' : 'forbidden' };
  }

  private async writeAudit(
    req: BrokerForwardRequest,
    ctx: AuditCtx,
    started: number,
    outcome: 'forwarded' | 'denied' | 'failed',
    reason: string | null,
  ): Promise<void> {
    const result = outcome === 'forwarded' ? 'ok' : outcome === 'denied' ? `denied:${reason}` : `error:${reason}`;
    await this.audit.record({
      actorUserId: req.caller.userId,
      action: BROKER_FORWARD_AUDIT_ACTION,
      targetType: ctx.secretId ? 'secret' : 'user',
      targetId: ctx.secretId ?? req.caller.userId,
      // Ids, the origin, the method, the path WITHOUT its query, counts and timing. Never the key,
      // a body, the query string or a header.
      meta: {
        result,
        outcome,
        reason,
        credential: req.caller.kind === 'broker' ? 'broker' : 'pat',
        tokenId: req.caller.tokenId,
        secretId: ctx.secretId ?? null,
        origin: ctx.origin ?? null,
        method: ctx.method,
        path: ctx.path ?? null,
        status: ctx.status ?? null,
        requestBytes: ctx.requestBytes,
        responseBytes: ctx.responseBytes,
        durationMs: Math.max(0, this.now() - started),
      },
    });
  }
}
