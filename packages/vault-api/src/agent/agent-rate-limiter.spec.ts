import { InMemoryAgentRateLimiter } from './agent-rate-limiter';

describe('InMemoryAgentRateLimiter', () => {
  it('allows up to the limit per window, then reports the seconds to wait', () => {
    const limiter = new InMemoryAgentRateLimiter();
    let now = 1_000_000;
    limiter.now = () => now;
    expect(limiter.consume('k', 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume('k', 2).allowed).toBe(true);
    now += 15_500;
    expect(limiter.consume('k', 2)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('starts a new window after the old one ends and counts keys separately', () => {
    const limiter = new InMemoryAgentRateLimiter();
    let now = 5_000;
    limiter.now = () => now;
    expect(limiter.consume('a', 1).allowed).toBe(true);
    expect(limiter.consume('a', 1).allowed).toBe(false);
    expect(limiter.consume('b', 1).allowed).toBe(true);
    now += 60_000;
    expect(limiter.consume('a', 1).allowed).toBe(true);
  });
});
