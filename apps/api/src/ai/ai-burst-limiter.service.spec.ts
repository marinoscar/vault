import {
  BURST_MAX_IN_WINDOW,
  BURST_WINDOW_MS,
} from './ai.constants';
import { AiBurstLimiterService } from './ai-burst-limiter.service';

describe('AiBurstLimiterService', () => {
  let limiter: AiBurstLimiterService;
  const now = 1_700_000_000_000;

  beforeEach(() => {
    limiter = new AiBurstLimiterService();
  });

  it('allows exactly BURST_MAX_IN_WINDOW attempts then denies', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      expect(limiter.consume('user-1', now + i).allowed).toBe(true);
    }

    const denied = limiter.consume('user-1', now + BURST_MAX_IN_WINDOW);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('reports a Retry-After that expires with the oldest hit', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      limiter.consume('user-1', now);
    }

    // Half the window has passed since the oldest hit.
    const decision = limiter.consume('user-1', now + BURST_WINDOW_MS / 2);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(BURST_WINDOW_MS / 2 / 1000);
  });

  it('lets the window slide', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      limiter.consume('user-1', now);
    }
    expect(limiter.consume('user-1', now).allowed).toBe(false);

    expect(limiter.consume('user-1', now + BURST_WINDOW_MS + 1).allowed).toBe(
      true,
    );
  });

  it('tracks users independently', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      limiter.consume('user-1', now);
    }

    expect(limiter.consume('user-1', now).allowed).toBe(false);
    expect(limiter.consume('user-2', now).allowed).toBe(true);
  });

  it('a denied attempt does not extend the window', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      limiter.consume('user-1', now);
    }
    // Hammering while denied must not push the reset further out.
    limiter.consume('user-1', now + 1000);
    limiter.consume('user-1', now + 2000);

    expect(limiter.consume('user-1', now + BURST_WINDOW_MS + 1).allowed).toBe(
      true,
    );
  });

  it('sweep drops fully expired windows so the map cannot grow forever', () => {
    limiter.consume('user-1', now);
    limiter.consume('user-2', now);

    limiter.sweep(now + BURST_WINDOW_MS + 1);

    // A swept user starts from a clean window.
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      expect(
        limiter.consume('user-1', now + BURST_WINDOW_MS + 2 + i).allowed,
      ).toBe(true);
    }
  });

  it('sweep keeps windows that are still live', () => {
    for (let i = 0; i < BURST_MAX_IN_WINDOW; i++) {
      limiter.consume('user-1', now);
    }

    limiter.sweep(now + 1000);

    expect(limiter.consume('user-1', now + 1000).allowed).toBe(false);
  });
});
