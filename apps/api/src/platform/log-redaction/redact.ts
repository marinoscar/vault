// =============================================================================
// Log redaction (stop-gap, issue #246; docs/platform-adoption/local-exceptions.md)
// =============================================================================
//
// The platform's `HttpExceptionFilter` and `LoggingInterceptor` write
// `METHOD <request.url> - status`, query string included, and Fastify's own
// request logger does the same. A credential mistakenly sent in a query
// parameter (`?access_token=vbk_...`) would land in the logs in plaintext.
//
// Two masks, applied to log text only (never to the request the handlers see):
//   1. every query-string VALUE in anything that looks like `?k=v&k2=v2`;
//   2. token-shaped substrings of the Vault credential families, wherever they
//      appear (`vbk_`, `pat_`, `oat_`, `nod_` followed by 16+ token characters).
// Requests are never rejected because a value looks like a token.
// =============================================================================

export const REDACTED = '[redacted]';

const QUERY_PAIR = /([?&][^=&\s#"'\\]+)=([^&\s#"'\\]*)/g;
const TOKEN_SHAPED = /\b(vbk|pat|oat|nod)_[A-Za-z0-9_-]{16,}/g;

/** Masks query-string values and token-shaped substrings in a piece of log text. */
export function redactLogText(text: string): string {
  if (text.length === 0) return text;
  return text.replace(QUERY_PAIR, `$1=${REDACTED}`).replace(TOKEN_SHAPED, `$1_${REDACTED}`);
}

/** The same mask, for a value that is only redacted when it is a string. */
export function redactLogArg(arg: unknown): unknown {
  return typeof arg === 'string' ? redactLogText(arg) : arg;
}
