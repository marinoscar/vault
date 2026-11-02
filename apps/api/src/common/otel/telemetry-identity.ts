// =============================================================================
// Who this process is to OpenTelemetry (issue #90, E9.2)
// =============================================================================
//
// Two names, each resolved in exactly one place:
//
//   * the SERVICE NAME (`service.name`): `OTEL_SERVICE_NAME`, else `${APP_SLUG}-api`.
//     Read by `instrumentation.ts`, `config/configuration.ts`,
//     `common/logger/pino.config.ts` and the telemetry app-info binding.
//   * the INSTANCE ID (`app.instance.id`): the label the telemetry gate stamps on
//     every exported batch so several deployments can share one store. The
//     administrator may override it at runtime (`telemetry.instanceId`).
//
// SAFE TO IMPORT BEFORE THE SDK STARTS: `instrumentation.ts` is loaded first
// thing by `main.ts`, and auto-instrumentation only patches modules required
// AFTER `initializeOtel()`. The `otel-core/sdk` subpath imports no `@nestjs/*`,
// `http`, `pg` or `pino`; `@app/shared` is plain CommonJS. Keep it that way.
// =============================================================================

import { APP_SLUG } from '@app/shared';
import {
  resolveServiceName as resolvePlatformServiceName,
  resolveTelemetryInstanceId as resolvePlatformInstanceId,
} from '@marinoscar/platform-api/otel-core/sdk';

/** The service name this process reports: `OTEL_SERVICE_NAME`, else `${APP_SLUG}-api`. */
export function resolveServiceName(): string {
  return resolvePlatformServiceName(`${APP_SLUG}-api`);
}

/** The `app.instance.id` this process is stamped with: the configured value, else the app slug. */
export function resolveTelemetryInstanceId(configured: string | null | undefined = null): string {
  return resolvePlatformInstanceId(configured, APP_SLUG);
}
