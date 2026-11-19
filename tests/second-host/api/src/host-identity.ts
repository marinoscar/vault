import identity from '../../packages/shared/identity.json';

/**
 * Host Beta's identity (`packages/shared/identity.json`): a different product name and slug from
 * Vault's, so anything in the packages that assumed "I am Vault" shows up in this host.
 */
export const HOST_IDENTITY = identity;

/** The app slug the host names its own things with (`hostbeta`). */
export const HOST_SLUG = identity.cliName;

/** The host's public base URL (an invented placeholder). */
export const HOST_APP_URL = 'https://host.example.test';
