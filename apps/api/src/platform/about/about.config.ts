// =============================================================================
// About, served by the platform (issue #76)
// =============================================================================
//
// `GET /api/admin/about` (`system_settings:read`): the deployment record the
// deploy CLI wrote to `DEPLOY_INFO_PATH`, live runtime facts and a database
// liveness probe. `resolveApiVersion` is the platform's (`APP_VERSION`, else the
// npm version, else `package.json`), so the version it shows is the one the
// OpenAPI document reports.
// =============================================================================

import { AboutModule, resolveApiVersion } from '@marinoscar/platform-api/host';

import { platformHost } from '../platform-host';

export const aboutModule = AboutModule.forRoot({
  apiVersion: () => resolveApiVersion(__dirname),
  host: platformHost,
});
