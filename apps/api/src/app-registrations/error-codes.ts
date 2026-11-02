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
import { VAULT_ERROR_CODES as VAULT_ERROR_CODE_DEFS } from '@marinoscar/vault-contract/errors';

// The definitions are data in `@marinoscar/vault-contract/errors` (the wire contract); this file only
// registers them with the platform. A new code goes in the package, with its status.
export const VAULT_ERROR_CODES: readonly ErrorCodeDef[] = VAULT_ERROR_CODE_DEFS;

for (const def of VAULT_ERROR_CODES) registerErrorCode(def);
