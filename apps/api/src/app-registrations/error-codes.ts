// =============================================================================
// Vault's machine-readable error codes (issue #76, epic #54)
// =============================================================================
//
// The platform `HttpExceptionFilter` keeps an application-supplied `code` ONLY
// when it is registered in core's error-code registry with the status the
// exception carries; any other code is replaced by the status default
// (`BAD_REQUEST`, `NOT_FOUND`, ...), and a status with no default (502, 503)
// becomes `ERROR`. Vault's pre-platform filter passed every code through and
// mapped 502 and 503 to BAD_GATEWAY and SERVICE_UNAVAILABLE. The platform's
// status defaults are fixed (502 and 503 answer `ERROR` when the exception names
// no registered code), so every code a client reads is registered here, with
// the status it is thrown with.
//
// IMPORTED BY `platform/host-core.config.ts` (through `./host`), so it runs
// before the application is created: the registry freezes when it bootstraps.
// A new code that clients read goes here, with its status.
// =============================================================================

import { registerErrorCode, type ErrorCodeDef } from '@marinoscar/platform-api/core';

export const VAULT_ERROR_CODES: readonly ErrorCodeDef[] = Object.freeze([
  // Seed and encryption preconditions.
  { code: 'DATABASE_SEED_REQUIRED', status: 500, description: 'Migrations ran but the seed data (roles, permissions) is missing.' },
  { code: 'ENCRYPTION_UNAVAILABLE', status: 503, description: 'VAULT_ENCRYPTION_KEY is not configured, so a secret value could not be stored.' },

  // Card scanning (`src/ai/ai.constants.ts`, `AI_ERROR_CODES`). The platform's own `AI_*` codes
  // (kill switch, key, model, limits) are registered by the AI slice.
  { code: 'AI_NOT_CONFIGURED', status: 503, description: 'AI card scanning is not set up (provider, model or deployment key missing).' },
  { code: 'AI_INVALID_IMAGE', status: 400, description: 'The images are not acceptable base64 data URLs within the size limit.' },
  { code: 'AI_RATE_LIMITED', status: 429, description: 'The per-user per-minute AI limit was reached.' },
  { code: 'AI_QUOTA_EXCEEDED', status: 429, description: 'A daily AI limit (per user or per organization) was reached.' },
  { code: 'AI_UPSTREAM_RATE_LIMITED', status: 429, description: 'The AI provider is rate limiting requests.' },
  { code: 'AI_UPSTREAM_AUTH', status: 502, description: 'The AI provider rejected the configured API key.' },
  { code: 'AI_UPSTREAM_UNAVAILABLE', status: 502, description: 'The AI provider failed, timed out or was unreachable.' },
  { code: 'AI_EXTRACTION_FAILED', status: 422, description: 'The model refused, or its output did not validate.' },
]);

for (const def of VAULT_ERROR_CODES) registerErrorCode(def);
