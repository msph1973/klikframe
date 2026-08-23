/**
 * Vendor-neutral rate-limit contract (ARCHITECTURE.md §3.4, SECURITY.md §6).
 * The Upstash adapter (`upstash-rate-limiter.ts`) implements this with an
 * atomic multi-key Redis script; the deterministic in-memory fake
 * (`fake-rate-limiter.ts`) mirrors the exact same observable semantics so
 * fast CI tests exercise the shared contract (TESTING.md §2.3).
 *
 * Shared multi-window contract (mirrors @upstash/ratelimit's combined
 * limiters): every window is evaluated and consumed in ONE atomic step;
 * the overall result succeeds only if EVERY window passes, and consumed
 * slots are never rolled back across windows when another window fails.
 * A caller therefore models e.g. SECURITY.md §6's "portal token resolve:
 * 10 req/min per IP + token fingerprint" as two windows on one limiter.
 */
export interface RateLimitWindow {
  /** Storage key for this window (already scoped by the caller, e.g. `login:<ip>`). */
  readonly key: string;
  /** Maximum hits allowed inside one sliding-fixed window of `windowMs`. */
  readonly limit: number;
  /** Window duration in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitSuccess {
  readonly success: true;
  /** Smallest configured limit across the evaluated windows. */
  readonly limit: number;
  /** Hits still available in the tightest window. */
  readonly remaining: number;
  /** When every window has fully rolled over (max window end). */
  readonly resetAt: Date;
}

export interface RateLimitFailure {
  readonly success: false;
  /** Limit of the binding (tightest remaining) window. */
  readonly limit: number;
  /** Remaining hits in the binding window (0 on failure). */
  readonly remaining: number;
  /** When the binding window rolls over and a retry can succeed. */
  readonly resetAt: Date;
  /** Milliseconds until `resetAt`; feeds a `Retry-After` header. */
  readonly retryAfterMs: number;
}

export type RateLimitResult = RateLimitSuccess | RateLimitFailure;

export interface RateLimiter {
  /**
   * Evaluates all windows atomically. Throws `ProviderError` ("permanent")
   * when called without at least one window; provider failures map to the
   * frozen taxonomy by each implementation.
   */
  limit(windows: readonly [RateLimitWindow, ...RateLimitWindow[]]): Promise<RateLimitResult>;
}
