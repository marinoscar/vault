import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  BURST_MAX_IN_WINDOW,
  BURST_WINDOW_MS,
  VERIFY_BURST_MAX_IN_WINDOW,
  VERIFY_BURST_WINDOW_MS,
} from './ai.constants';

export interface BurstDecision {
  allowed: boolean;
  /** Seconds until the oldest hit ages out. Only meaningful when denied. */
  retryAfterSeconds: number;
}

/** A sliding-window configuration. */
export interface BurstWindowConfig {
  windowMs: number;
  maxInWindow: number;
}

export const EXTRACT_BURST: BurstWindowConfig = {
  windowMs: BURST_WINDOW_MS,
  maxInWindow: BURST_MAX_IN_WINDOW,
};

export const VERIFY_BURST: BurstWindowConfig = {
  windowMs: VERIFY_BURST_WINDOW_MS,
  maxInWindow: VERIFY_BURST_MAX_IN_WINDOW,
};

/**
 * Longest configured window. The sweep must use this, not whichever window it
 * happens to think of first, or it would evict live entries belonging to the
 * other config.
 */
const LONGEST_WINDOW_MS = Math.max(
  EXTRACT_BURST.windowMs,
  VERIFY_BURST.windowMs,
);

/**
 * Per-user sliding-window burst limiter for AI extractions.
 *
 * SCOPE AND LIMITS - read before relying on this:
 *   - It is PER REPLICA. Two API containers each allow the full window, so the
 *     effective burst ceiling is `BURST_MAX_IN_WINDOW x replica count`.
 *   - It RESETS ON DEPLOY. Restarting the process clears every window.
 *
 * That is acceptable because this control exists to stop a stuck client from
 * hammering the provider in a tight loop, not to enforce spend. Spend is
 * enforced by the durable daily budget in CardExtractService, which counts
 * `audit_events` rows and is therefore both restart-proof and multi-replica
 * safe. If a hard cross-replica burst limit is ever needed it belongs in Redis
 * or in the database, not here.
 */
@Injectable()
export class AiBurstLimiterService {
  private readonly logger = new Logger(AiBurstLimiterService.name);

  /** bucket key -> ascending timestamps of accepted attempts in the window. */
  private readonly hits = new Map<string, number[]>();

  /**
   * Record an attempt if the window allows it.
   *
   * `key` is a bucket identifier, not necessarily a bare user id: callers that
   * limit a different action namespace it (see `verifyKey`) so that pressing
   * "test connection" cannot eat into the same user's card-scanning allowance.
   *
   * `now` is injectable purely so tests can advance time without sleeping.
   */
  consume(
    key: string,
    now: number = Date.now(),
    config: BurstWindowConfig = EXTRACT_BURST,
  ): BurstDecision {
    const cutoff = now - config.windowMs;
    const recent = (this.hits.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= config.maxInWindow) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + config.windowMs - now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Bucket key for the admin verify probe.
   *
   * Namespaced so a user id can never collide with the extraction bucket.
   */
  static verifyKey(userId: string): string {
    return `verify:${userId}`;
  }

  /**
   * Drop windows that have fully aged out.
   *
   * Without this the map grows one entry per user who has ever scanned a card
   * and never shrinks - a slow leak in a long-lived process. Uses the
   * `ScheduleModule` already registered at the app root.
   */
  @Interval('ai-burst-limiter-sweep', 60_000)
  sweep(now: number = Date.now()): void {
    const cutoff = now - LONGEST_WINDOW_MS;
    let removed = 0;

    for (const [key, timestamps] of this.hits.entries()) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) {
        this.hits.delete(key);
        removed++;
      } else if (recent.length !== timestamps.length) {
        this.hits.set(key, recent);
      }
    }

    if (removed > 0) {
      this.logger.debug(`Swept ${removed} expired AI burst window(s)`);
    }
  }

  /** Test/diagnostic helper. */
  reset(): void {
    this.hits.clear();
  }
}
