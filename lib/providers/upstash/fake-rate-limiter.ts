import type { Clock } from "@/lib/shared/clock";
import { ProviderError } from "@/lib/shared/provider-error";
import type {
  RateLimitResult,
  RateLimiter,
  RateLimitWindow,
} from "./rate-limit-port";

/**
 * Deterministic in-memory `RateLimiter` (TESTING.md §2.3 "in-memory limiter
 * with shared contract"). Reproduces the Upstash REST adapter's observable
 * semantics exactly:
 * - fixed windows keyed by `<key>:<windowIndex>` (no cross-window state),
 * - one atomic consume step across ALL windows — a failure in any window
 *   still persists the hits consumed by the windows that passed,
 * - injectable `Clock`, no randomness, no timers: fully deterministic.
 */
export class FakeRateLimiter implements RateLimiter {
  /** key -> windowIndex -> hits inside that fixed window. */
  private readonly buckets = new Map<string, Map<number, number>>();

  constructor(private readonly clock: Clock) {}

  async limit(
    windows: readonly [RateLimitWindow, ...RateLimitWindow[]],
  ): Promise<RateLimitResult> {
    await Promise.resolve();
    if (windows.length === 0) {
      throw new ProviderError("permanent", { provider: "upstash", operation: "limit" }, "At least one rate limit window is required");
    }

    const nowMs = this.clock.now().getTime();

    // Validate every window BEFORE any state changes: a later window's
    // invalid config must not leave earlier windows' hits committed
    // (mirrors UpstashRestRateLimiter.assertWindows and the fake's
    // no-state-on-invalid contract).
    for (const window of windows) {
      this.assertWindow(window);
    }

    // One sequential consume pass mirroring the Lua script line-for-line:
    // each window occurrence INCRs its bucket against the bucket's CURRENT
    // value (two windows may share one bucket when key+windowMs coincide,
    // and a blocked occurrence's rollback must be visible to the next),
    // then either keeps the hit or rolls it back when the limit is passed.
    // The reported row matches the script: a granted window reports its
    // incremented count (>= 1, possibly == limit after draining the last
    // slot); a blocked window reports 0 — the unambiguous sentinel, since
    // a granted row can never be 0.
    const outcomes = windows.map((window) => {
      const index = Math.floor(nowMs / window.windowMs);
      const bucketKey = `${window.key}:${String(index)}`;
      const used = this.buckets.get(bucketKey)?.get(index) ?? 0;
      if (used >= window.limit) {
        return { window, resetAtMs: (index + 1) * window.windowMs, blocked: true as const };
      }
      const bucket = this.buckets.get(bucketKey) ?? new Map<number, number>();
      if (!this.buckets.has(bucketKey)) this.buckets.set(bucketKey, bucket);
      bucket.set(index, used + 1);
      return {
        window,
        resetAtMs: (index + 1) * window.windowMs,
        blocked: false as const,
        used: used + 1,
      };
    });

    /** Slots left after this call, per window, from its committed row. */
    function postRemaining(outcome: (typeof outcomes)[number]): number {
      return outcome.blocked ? 0 : Math.max(0, outcome.window.limit - outcome.used);
    }

    // Success iff NO window was rolled back — taking a window's very last
    // slot is still a success (that window simply reports used == limit).
    if (outcomes.every((outcome) => !outcome.blocked)) {
      const tightest = outcomes.reduce((min, outcome) =>
        outcome.window.limit < min.window.limit ? outcome : min,
      );
      return {
        success: true,
        limit: tightest.window.limit,
        remaining: Math.min(...outcomes.map(postRemaining)),
        // Every configured window must have rolled over before a caller
        // can treat all counters as fresh again.
        resetAt: new Date(Math.max(...outcomes.map((outcome) => outcome.resetAtMs))),
      };
    }

    // Failure binds to the set of windows whose POST-consume remaining is
    // zero: the blocked windows PLUS windows this call just drained. A
    // retry can only succeed once every such window has rolled over, so
    // resetAt is the LATEST rollover among them; limit and resetAt label
    // come from the member attaining that maximum (ties break to the
    // lowest index, matching the real adapter's reduction order).
    let binding: (typeof outcomes)[number] | undefined;
    for (const outcome of outcomes) {
      if (postRemaining(outcome) !== 0) continue;
      if (!binding || outcome.resetAtMs > binding.resetAtMs) {
        binding = outcome;
      }
    }
    if (!binding) {
      throw new ProviderError("permanent", { provider: "upstash", operation: "limit" }, "At least one rate limit window is required");
    }
    return {
      success: false,
      limit: binding.window.limit,
      remaining: 0,
      resetAt: new Date(binding.resetAtMs),
      retryAfterMs: Math.max(0, binding.resetAtMs - nowMs),
    };
  }

  private assertWindow(window: RateLimitWindow): void {
    if (!Number.isInteger(window.limit) || window.limit < 1) {
      throw new ProviderError(
        "permanent",
        { provider: "upstash", operation: "limit" },
        "Rate limit window requires a positive integer limit",
      );
    }
    // Whole seconds only, exactly like the Upstash REST adapter: the Lua
    // script indexes buckets in whole seconds, so a sub-second windowMs
    // would make the fake and the real limiter disagree on both the
    // enforced limit and resetAt (cubic FM6bh9nJ).
    if (
      !Number.isInteger(window.windowMs) ||
      window.windowMs < 1000 ||
      window.windowMs % 1000 !== 0
    ) {
      throw new ProviderError(
        "permanent",
        { provider: "upstash", operation: "limit" },
        "Rate limit window requires a whole number of seconds (windowMs must be a positive multiple of 1000)",
      );
    }
    if (window.key.length === 0) {
      throw new ProviderError(
        "permanent",
        { provider: "upstash", operation: "limit" },
        "Rate limit window requires a non-empty key",
      );
    }
  }
}

