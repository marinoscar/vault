// =============================================================================
// The platform host core (issue #76, epic #54)
// =============================================================================
//
// `PlatformHostCoreModule.forRoot` is GLOBAL and replaces what Vault ran by hand:
//
//   * the event bus (`EVENT_BUS`) and `AppMetricsService`;
//   * maintenance mode: `MaintenanceModeService`, `GET|PUT /api/admin/maintenance`
//     and `MaintenanceGuard`, the application's ONLY `APP_GUARD`;
//   * `GET /api/health`, `/api/health/live` and `/api/health/ready`;
//   * the `{ data, meta }` envelope (`TransformInterceptor`), the request log
//     line (`LoggingInterceptor`), `HttpExceptionFilter` and request ids.
//
// `./host` is imported FIRST so the error codes this app registers exist before
// the application is created (the registries freeze when it bootstraps).
//
// `EventEmitterModule.forRoot()` STAYS in `AppModule`: the legacy auth service
// and `@OnEvent` handlers run on it. The platform event bus is separate.
// =============================================================================

import '../app-registrations/host';
import '../common/otel/app-metric.manifest';

import { PlatformHostCoreModule } from '@marinoscar/platform-api/host';

import { platformHost } from './platform-host';

export const hostCoreModule = PlatformHostCoreModule.forRoot({ host: platformHost });
