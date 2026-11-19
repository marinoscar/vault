import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';

/**
 * A recording reverse proxy in front of the Vault under test: the runtime talks to it, it talks to
 * the Vault. It sees the same traffic whether the Vault is the fake or a real deployment, which is
 * what lets one scenario list check both. Bodies are held in memory for the run only.
 */

/** One event of a scenario, in order. @stability beta */
export type ConformanceEvent =
  | {
      kind: 'request';
      seq: number;
      at: number;
      method: string;
      /** Path under the Vault, without the query. */
      path: string;
      query: Record<string, string>;
      body: unknown;
      /** The page's top-level origin when the request was sent. */
      pageOrigin: string | null;
    }
  | {
      kind: 'response';
      seq: number;
      at: number;
      requestSeq: number;
      method: string;
      path: string;
      status: number;
      code?: string;
      headers: Record<string, string>;
      body: unknown;
    }
  | { kind: 'type'; seq: number; at: number; field: string; value: string; pageOrigin: string }
  | { kind: 'ask'; seq: number; at: number; choices: number; answer: string | null }
  | { kind: 'connect'; seq: number; at: number };

/** An event before the log stamps it. */
type WithoutStamp<E> = E extends unknown ? Omit<E, 'seq' | 'at'> : never;

/** The shared event log of a run. */
export class ConformanceLog {
  private seqCounter = 0;
  events: ConformanceEvent[] = [];

  push<E extends ConformanceEvent = ConformanceEvent>(event: WithoutStamp<E>): E {
    const full = { ...event, seq: ++this.seqCounter, at: Date.now() } as E;
    this.events.push(full);
    return full;
  }

  /** Forgets every event (and with them every value seen). */
  clear(): void {
    this.events = [];
  }
}

const SAFE_HEADERS = ['cache-control', 'pragma', 'retry-after', 'www-authenticate', 'content-type'];

/** A started recorder. */
export interface ConformanceRecorder {
  baseUrl: string;
  /** Called with each response before it reaches the runtime. */
  onResponse: ((event: Extract<ConformanceEvent, { kind: 'response' }>) => void) | null;
  /** Reads the page origin to stamp on a request. */
  pageOrigin: () => string | null;
  stop(): Promise<void>;
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Starts a recorder in front of `targetBaseUrl` on 127.0.0.1. */
export async function startRecorder(targetBaseUrl: string, log: ConformanceLog): Promise<ConformanceRecorder> {
  const target = new URL(targetBaseUrl);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const recorder: ConformanceRecorder = {
    baseUrl: '',
    onResponse: null,
    pageOrigin: () => null,
    stop: async () => undefined,
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://recorder.invalid');
      const requestEvent = log.push<Extract<ConformanceEvent, { kind: 'request' }>>({
        kind: 'request',
        method: (req.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: parseJson(raw.toString('utf8')),
        pageOrigin: recorder.pageOrigin(),
      });
      const headers = { ...req.headers, host: target.host };
      delete headers['content-length'];
      const upstream = send(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: req.method,
          path: `${target.pathname.replace(/\/+$/, '')}${req.url ?? '/'}`,
          headers: { ...headers, ...(raw.length > 0 ? { 'content-length': String(raw.length) } : {}) },
        },
        (up) => {
          const body: Buffer[] = [];
          up.on('data', (c: Buffer) => body.push(c));
          up.on('end', () => {
            const text = Buffer.concat(body);
            const kept: Record<string, string> = {};
            for (const name of SAFE_HEADERS) {
              const value = up.headers[name];
              if (value !== undefined) kept[name] = Array.isArray(value) ? value.join(', ') : String(value);
            }
            const parsed = parseJson(text.toString('utf8'));
            const code =
              parsed && typeof parsed === 'object' && typeof (parsed as { code?: unknown }).code === 'string'
                ? (parsed as { code: string }).code
                : undefined;
            const responseEvent = log.push<Extract<ConformanceEvent, { kind: 'response' }>>({
              kind: 'response',
              requestSeq: requestEvent.seq,
              method: requestEvent.method,
              path: requestEvent.path,
              status: up.statusCode ?? 0,
              ...(code ? { code } : {}),
              headers: kept,
              body: parsed,
            });
            try {
              recorder.onResponse?.(responseEvent);
            } catch {
              // A scenario hook never breaks the transport.
            }
            const out: Record<string, string | string[]> = {};
            for (const [name, value] of Object.entries(up.headers)) {
              if (value !== undefined && name !== 'transfer-encoding' && name !== 'connection') out[name] = value;
            }
            out['content-length'] = String(text.length);
            res.writeHead(up.statusCode ?? 502, out);
            res.end(text);
          });
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'The Vault under test did not answer' }));
      });
      upstream.end(raw);
    });
  };

  const server: Server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  recorder.baseUrl = `http://127.0.0.1:${port}`;
  recorder.stop = async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return recorder;
}
