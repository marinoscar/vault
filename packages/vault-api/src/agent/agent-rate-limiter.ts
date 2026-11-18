/** The answer of {@link AgentRateLimiter.consume}. */
export interface AgentRateDecision {
  /** Whether the call may proceed. */
  allowed: boolean;
  /** Seconds until the window resets (at least 1) when `allowed` is false; 0 otherwise. */
  retryAfterSeconds: number;
}

/**
 * Counts agent API calls per key. The key is `<bucket>:<token or grant>:<user>`; the limit is the
 * deployment's `agentAccess.<bucket>PerMinute` setting. An abstract class so it is the DI token:
 * the default {@link InMemoryAgentRateLimiter} is right for a single API instance; a deployment
 * that runs several replaces it (`{ provide: AgentRateLimiter, useClass: ... }`) with a shared
 * counter.
 *
 * @extensionPoint token
 * @stability experimental
 */
export abstract class AgentRateLimiter {
  /** Counts one call against `key` and says whether it is within `limit` per `windowMs`. */
  abstract consume(key: string, limit: number, windowMs?: number): AgentRateDecision;
}

/**
 * A fixed-window counter in process memory. State is lost on restart and is per instance, which is
 * the deployment today (one API). Expired windows are pruned as the map grows.
 *
 * @stability experimental
 */
export class InMemoryAgentRateLimiter extends AgentRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /** The clock; a test replaces it. */
  now: () => number = () => Date.now();

  consume(key: string, limit: number, windowMs = 60_000): AgentRateDecision {
    const now = this.now();
    if (this.windows.size > 5_000) this.prune(now);
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
  }
}
