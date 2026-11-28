import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';

import type { BrokerHeaders } from './broker-http';

/**
 * The two network ports of the credential broker (ADR-0006 decision 8): resolving a host name, and
 * sending one HTTPS request to an address that was already validated. Both are abstract classes so
 * they are DI tokens: the defaults below are the production ones; a test provides fakes or a
 * connector that trusts an extra test certificate authority. Neither can weaken the checks the
 * forward service makes (every address is checked after resolving, TLS verification is never
 * switched off).
 */

/** One address a host name resolved to. */
export interface BrokerResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolves a host name to every address it has. The forward service calls it ONCE per request and
 * pins the connection to a checked address.
 *
 * @extensionPoint token
 * @stability experimental
 */
export abstract class BrokerResolver {
  abstract resolveAll(hostname: string): Promise<BrokerResolvedAddress[]>;
}

/** The operating system's resolver (`dns.lookup`, every address, the order it gave). */
export class SystemBrokerResolver extends BrokerResolver {
  async resolveAll(hostname: string): Promise<BrokerResolvedAddress[]> {
    const literal = isIP(hostname);
    if (literal !== 0) return [{ address: hostname, family: literal as 4 | 6 }];
    const found = await dnsLookup(hostname, { all: true, verbatim: true });
    return found.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
  }
}

/** One request to an upstream. */
export interface BrokerUpstreamRequest {
  /** The host name (or IP literal) for SNI, certificate verification and the Host header. */
  hostname: string;
  port: number;
  /** The validated address to connect to: the connection never resolves the name again. */
  address: string;
  family: 4 | 6;
  method: string;
  /** Path and query, starting with `/`. */
  path: string;
  headers: BrokerHeaders;
  /** The request body, or `null`. An error on this stream aborts the request and is rethrown. */
  body: Readable | null;
  /** The deadline of the whole exchange. */
  timeoutMs: number;
  /** The most response bytes read (as sent on the wire, before any decoding). */
  maxResponseBytes: number;
}

/** What the upstream answered. */
export interface BrokerUpstreamResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A transport failure with a stable code (no address, no detail beyond it). */
export class BrokerUpstreamFailure extends Error {
  constructor(readonly code: 'timeout' | 'too_large' | 'error') {
    super(`broker upstream ${code}`);
    this.name = 'BrokerUpstreamFailure';
  }
}

/**
 * Sends one request. The default is {@link NodeHttpsBrokerUpstream}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export abstract class BrokerUpstream {
  /** @throws BrokerUpstreamFailure on a timeout, an oversized response or a connection failure; rethrows an error of `request.body`. */
  abstract send(request: BrokerUpstreamRequest): Promise<BrokerUpstreamResponse>;
}

/** Options of the default connector. Only TLS trust can be extended, never relaxed. */
export interface NodeHttpsBrokerUpstreamOptions {
  /** Extra certificate authorities to trust besides the system's (a test CA). Verification stays on. */
  ca?: string | Buffer | Array<string | Buffer>;
}

/**
 * The default connector: `node:https` with certificate and host name verification on (never
 * `rejectUnauthorized: false`), TLS 1.2 or later, SNI and verification against the host name, the
 * connection pinned to the checked address by a `lookup` that returns it, no agent (no connection
 * reuse across requests or hosts), no redirect following (a 3xx is just a response).
 */
export class NodeHttpsBrokerUpstream extends BrokerUpstream {
  constructor(private readonly options: NodeHttpsBrokerUpstreamOptions = {}) {
    super();
  }

  send(req: BrokerUpstreamRequest): Promise<BrokerUpstreamResponse> {
    return new Promise<BrokerUpstreamResponse>((resolve, reject) => {
      let settled = false;
      const done = (error: Error | null, value?: BrokerUpstreamResponse): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (error) {
          upstream.destroy();
          reject(error);
        } else resolve(value as BrokerUpstreamResponse);
      };

      const hostHeader = `${req.family === 6 && isIP(req.hostname) === 6 ? `[${req.hostname}]` : req.hostname}${req.port === 443 ? '' : `:${req.port}`}`;
      const options: RequestOptions = {
        host: req.hostname,
        port: req.port,
        method: req.method,
        path: req.path,
        headers: { ...req.headers, host: hostHeader },
        agent: false,
        minVersion: 'TLSv1.2',
        // Pin: whatever the name is, connect to the address the forward service validated.
        lookup: (_host, lookupOptions, callback) => {
          if (lookupOptions && (lookupOptions as { all?: boolean }).all) {
            (callback as unknown as (e: Error | null, a: Array<{ address: string; family: number }>) => void)(null, [
              { address: req.address, family: req.family },
            ]);
          } else callback(null, req.address, req.family);
        },
        ...(isIP(req.hostname) === 0 ? { servername: req.hostname } : {}),
        ...(this.options.ca ? { ca: this.options.ca } : {}),
      };

      const upstream = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxResponseBytes) done(new BrokerUpstreamFailure('too_large'));
          else chunks.push(chunk);
        });
        res.on('end', () => done(null, { status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', () => done(new BrokerUpstreamFailure('error')));
        res.on('aborted', () => done(new BrokerUpstreamFailure('error')));
      });
      const deadline = setTimeout(() => done(new BrokerUpstreamFailure('timeout')), req.timeoutMs);
      upstream.on('error', () => done(new BrokerUpstreamFailure('error')));

      if (req.body) {
        req.body.on('error', (error) => done(error instanceof Error ? error : new Error('request body failed')));
        req.body.pipe(upstream);
      } else {
        upstream.end();
      }
    });
  }
}
