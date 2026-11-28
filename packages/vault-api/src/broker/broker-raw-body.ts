import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';

/**
 * Makes the raw request body of `/api/broker/v1/*` available for every content type
 * (ADR-0006 decision 8: the body is forwarded byte for byte, never parsed, and never buffered whole).
 *
 * Fastify parses a body by content type and refuses types it has no parser for. For the broker path
 * only, an `onRequest` hook (1) replaces the request's `content-type` with a private one whenever a
 * body is announced and (2) keeps the original in `request.brokerContentType`; one content-type parser
 * of that private type hands the controller the unread payload STREAM as `request.body`. Every other
 * route, and JSON parsing everywhere else, is untouched. A host calls this once on the Fastify
 * instance before the application initialises:
 *
 * ```ts
 * installBrokerRawBody(app.getHttpAdapter().getInstance());
 * ```
 *
 * @stability experimental
 */
export const BROKER_RAW_CONTENT_TYPE = 'application/x-vault-broker-raw' as const;

/** The path prefix the hook applies to. */
const BROKER_PATH = /^\/api\/broker\/v1(?:\/|$)/;

/** The original content type, kept for the forward. */
export type BrokerRawRequest = { brokerContentType?: string };

export function installBrokerRawBody(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(BROKER_RAW_CONTENT_TYPE, (_request: unknown, payload: Readable, done: (error: Error | null, body?: unknown) => void) => {
    done(null, payload);
  });
  fastify.addHook('onRequest', (request, _reply, done) => {
    const path = (request.raw.url ?? '').split('?')[0] ?? '';
    if (BROKER_PATH.test(path)) {
      const headers = request.headers;
      const hasBody = (headers['content-length'] !== undefined && headers['content-length'] !== '0') || headers['transfer-encoding'] !== undefined;
      if (hasBody) {
        (request as unknown as BrokerRawRequest).brokerContentType = headers['content-type'];
        headers['content-type'] = BROKER_RAW_CONTENT_TYPE;
      }
    }
    done();
  });
}
