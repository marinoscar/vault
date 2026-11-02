import { resolveApiVersion, type PlatformOpenApiOptions } from '@marinoscar/platform-api/host';

/** Vault's identity in the OpenAPI document and on `/api/docs` (Scalar). */
export const APP_OPENAPI: PlatformOpenApiOptions = {
  appName: 'Vault',
  repoUrl: 'https://github.com/marinoscar/vault',
  version: () => resolveApiVersion(__dirname),
};
