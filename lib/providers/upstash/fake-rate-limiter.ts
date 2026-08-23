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

    // Pass 1 — compute per-window outcomes WITHOUT mutating bucket state,
    // so the atomic multi-key contract holds even though this fake runs on
    // a single-threaded event loop.
    const evaluated = windows.map((window) => {
      this.assertWindow(window);
      const index = Math.floor(nowMs / window.windowMs);
      const bucketKey = `${window.key}:${String(index)}`;
      // A missing bucket counts as zero hits; the Map is created only when
      // the consume pass actually records a hit.
      const used = this.buckets.get(bucketKey)?.get(index) ?? 0;
      return {
        window,
        index,
        bucketKey,
        used,
        remaining: window.limit - used,
        resetAtMs: (index + 1) * window.windowMs,
      };
    });

    // The binding window is the one with the fewest slots left; ties break
    // to the earliest rollover so `resetAt` matches the real limiter's
    // "soonest retry" behavior.
    let binding = evaluated[0];
    if (!binding) {
      throw new ProviderError("permanent", { provider: "upstash", operation: "limit" }, "At least one rate limit window is required");
    }
    for (const candidate of evaluated.slice(1)) {
      if (
        candidate.remaining < binding.remaining ||
        (candidate.remaining === binding.remaining && candidate.resetAtMs < binding.resetAtMs)
      ) {
        binding = candidate;
      }
    }

    // Pass 2 — commit. Windows with a slot left always record their hit;
    // an exhausted window does not. This mirrors the Lua script's atomic
    // INCR-then-decide flow, where successful windows are not rolled back.
    for (const entry of evaluated) {
      if (entry.remaining <= 0) continue;
      let bucket = this.buckets.get(entry.bucketKey);
      if (!bucket) {
        bucket = new Map<number, number>();
        this.buckets.set(entry.bucketKey, bucket);
      }
      bucket.set(entry.index, entry.used + 1);
    }

    const overallSuccess = binding.remaining > 0;

    if (overallSuccess) {
      const tightest = evaluated.reduce((min, entry) =>
        entry.window.limit < min.window.limit ? entry : min,
      );
      return {
        success: true,
        limit: tightest.window.limit,
        remaining: binding.remaining - 1,
        // Every configured window must have rolled over before a caller
        // can treat all counters as fresh again.
        resetAt: new Date(Math.max(...evaluated.map((entry) => entry.resetAtMs))),
      };
    }

    return {
      success: false,
      limit: binding.window.limit,
      remaining: 0,
      resetAt: new Date(binding.resetAtMs),
      retryAfterMs: binding.resetAtMs - nowMs,
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
    if (!Number.isInteger(window.windowMs) || window.windowMs < 1) {
      throw new ProviderError(
        "permanent",
        { provider: "upstash", operation: "limit" },
        "Rate limit window requires a positive integer windowMs",
      );
    }
  }
}
