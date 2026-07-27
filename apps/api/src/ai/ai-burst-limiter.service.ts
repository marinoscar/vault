import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { BURST_MAX_IN_WINDOW, BURST_WINDOW_MS } from './ai.constants';

export interface BurstDecision {
  allowed: boolean;
  /** Seconds until the oldest hit ages out. Only meaningful when denied. */
  retryAfterSeconds: number;
}

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

  /** userId -> ascending timestamps of accepted attempts inside the window. */
  private readonly hits = new Map<string, number[]>();

  /**
   * Record an attempt if the window allows it.
   *
   * `now` is injectable purely so tests can advance time without sleeping.
   */
  consume(userId: string, now: number = Date.now()): BurstDecision {
    const cutoff = now - BURST_WINDOW_MS;
    const recent = (this.hits.get(userId) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= BURST_MAX_IN_WINDOW) {
      this.hits.set(userId, recent);
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + BURST_WINDOW_MS - now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    this.hits.set(userId, recent);
    return { allowed: true, retryAfterSeconds: 0 };
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
    const cutoff = now - BURST_WINDOW_MS;
    let removed = 0;

    for (const [userId, timestamps] of this.hits.entries()) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) {
        this.hits.delete(userId);
        removed++;
      } else if (recent.length !== timestamps.length) {
        this.hits.set(userId, recent);
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
