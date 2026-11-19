/**
 * The production guard of the conformance kit: every part that holds seeded values or serves HTTP
 * refuses to run when `NODE_ENV` is `production`. The kit is for a runtime's tests, never a store.
 */

/** Thrown when a kit part is started with `NODE_ENV=production`. @stability beta */
export class ConformanceKitInProductionError extends Error {
  constructor(what: string) {
    super(`${what} is a test tool and refuses to run with NODE_ENV=production`);
    this.name = 'ConformanceKitInProductionError';
  }
}

/**
 * Throws {@link ConformanceKitInProductionError} when `NODE_ENV` is `production`.
 *
 * @stability beta
 */
export function assertNotProduction(what: string, env: Record<string, string | undefined> = process.env): void {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') throw new ConformanceKitInProductionError(what);
}
