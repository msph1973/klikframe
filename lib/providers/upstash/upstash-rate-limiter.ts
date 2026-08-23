import { z } from "zod";
import type { Clock } from "@/lib/shared/clock";
import { getEnv } from "@/lib/config/env";
import { ProviderError, type ProviderErrorKind } from "@/lib/shared/provider-error";
import type {
  RateLimitResult,
  RateLimiter,
  RateLimitWindow,
} from "./rate-limit-port";
import { FIXED_WINDOW_MULTI_LUA, UPSTASH_SCRIPT_KEYS } from "./fixed-window-lua";

/**
 * Real `RateLimiter` backed by Upstash Redis REST (ARCHITECTURE.md §3.4).
 *
 * The multi-window check-and-consume runs server-side as ONE atomic Lua
 * script (`EVALSHA` with an `EVAL` fallback), matching the shared contract
 * documented on the port: every window is evaluated and consumed in a
 * single step and passing windows are never rolled back when another
 * window fails.
 *
 * Raw provider responses enter as `unknown`, are Zod-validated into typed
 * results, and every failure maps to the frozen `ProviderError` taxonomy
 * with a sanitized message — never the raw body, URL, or bearer token.
 */
export interface UpstashRestRateLimiterOptions {
  /** Test seam: inject a fetch implementation instead of globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface UpstashEnvelopeSuccess {
  readonly result: unknown;
  readonly error?: undefined;
}

interface UpstashEnvelopeFailure {
  readonly result?: undefined;
  readonly error: string;
}

type UpstashEnvelope = UpstashEnvelopeSuccess | UpstashEnvelopeFailure;

const upstashEnvelopeSchema: z.ZodType<UpstashEnvelope> = z.union([
  // Real Upstash responses omit `error` on success, so the key is optional.
  z.object({ result: z.unknown(), error: z.undefined().optional() }),
  z.object({ result: z.undefined().optional(), error: z.string().min(1) }),
]);

const scriptResultSchema = z.array(z.unknown()).min(1);

function providerError(
  kind: ProviderErrorKind,
  operation: string,
  message: string,
  cause?: unknown,
): ProviderError {
  return new ProviderError(
    kind,
    { provider: "upstash", operation },
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertWindows(windows: readonly RateLimitWindow[], operation: string): void {
  if (windows.length === 0) {
    throw providerError("permanent", operation, "At least one rate limit window is required");
  }
  for (const window of windows) {
    if (!Number.isInteger(window.limit) || window.limit < 1) {
      throw providerError("permanent", operation, "Rate limit window requires a positive integer limit");
    }
    if (
      !Number.isInteger(window.windowMs) ||
      window.windowMs < 1000 ||
      window.windowMs % 1000 !== 0
    ) {
      throw providerError(
        "permanent",
        operation,
        "Rate limit window requires a whole number of seconds (windowMs must be a positive multiple of 1000)",
      );
    }
    if (window.key.length === 0) {
      throw providerError("permanent", operation, "Rate limit window requires a non-empty key");
    }
  }
}

export class UpstashRestRateLimiter implements RateLimiter {
  private readonly clock: Clock;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private scriptSha: Promise<string> | null = null;

  constructor(clock: Clock, options: UpstashRestRateLimiterOptions = {}) {
    this.clock = clock;
    const env = getEnv();
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    // The adapter cannot run without its canonical env pair; fail fast at
    // construction so misconfiguration never surfaces mid-request.
    if (!url || !token) {
      throw new ProviderError(
        "permanent",
        { provider: "upstash", operation: "configure" },
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured for the Upstash adapter",
      );
    }
    this.endpoint = url.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async limit(
    windows: readonly [RateLimitWindow, ...RateLimitWindow[]],
  ): Promise<RateLimitResult> {
    assertWindows(windows, "limit");

    // One clock reading feeds both the script's window indexes and the
    // client-side result math, keeping them aligned to a single instant.
    const nowMs = this.clock.now().getTime();
    const args: string[] = [
      String(UPSTASH_SCRIPT_KEYS),
      String(Math.floor(nowMs / 1000)),
    ];
    for (const window of windows) {
      // assertWindows guarantees a whole-second windowMs, so the script's
      // second-based indexing is exact — no rounding drift between the
      // client-side reset math and the server-side window index.
      args.push(window.key, String(window.limit), String(window.windowMs / 1000));
    }

    const raw = await this.evalScript(args);
    const parsed = scriptResultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.length !== windows.length) {
      throw providerError("malformed_response", "limit", "Upstash rate limiter returned an unexpected response shape");
    }
    const usedCounts = parsed.data.map((row) => Number(row));
    if (usedCounts.some((used) => !Number.isFinite(used))) {
      throw providerError("malformed_response", "limit", "Upstash rate limiter returned non-numeric counter values");
    }
    return this.toResult(windows, usedCounts, nowMs);
  }

  private async evalScript(args: readonly string[]): Promise<unknown> {
    const sha = await this.loadScriptSha();
    let raw = await this.invokeEvalsha(sha, args);
    // NOSCRIPT / flushed cache: load once more, then retry exactly one time.
    if (raw !== null && typeof raw === "object" && "error" in raw) {
      const envelope = raw as UpstashEnvelope;
      if (typeof envelope.error === "string" && /noscript/i.test(envelope.error)) {
        await this.loadScript();
        this.scriptSha = null;
        const reloadedSha = await this.loadScriptSha();
        raw = await this.invokeEvalsha(reloadedSha, args);
      }
    }
    const shaped = upstashEnvelopeSchema.safeParse(raw);
    if (!shaped.success) {
      throw providerError("malformed_response", "limit", "Upstash rate limiter returned an unexpected response envelope");
    }
    if (shaped.data.error !== undefined) {
      // Sanitized on purpose: the raw error text may echo key names or
      // internal state; callers only need the retryability signal.
      throw providerError("retryable", "limit", "Upstash rate limiter rejected the script invocation");
    }
    return shaped.data.result;
  }

  private async invokeEvalsha(sha: string, args: readonly string[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/evalsha/${encodeURIComponent(sha)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
    } catch (cause) {
      throw providerError("retryable", "limit", "Upstash rate limiter is unreachable", cause);
    }
    if (!response.ok) {
      throw providerError(
        "retryable",
        "limit",
        `Upstash rate limiter responded with HTTP ${String(response.status)}`,
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch (cause) {
      throw providerError("malformed_response", "limit", "Upstash rate limiter returned a non-JSON response", cause);
    }
  }

  private loadScriptSha(): Promise<string> {
    this.scriptSha ??= this.loadScript();
    const captured = this.scriptSha;
    // A transient script-load failure must not poison the cache for the
    // warm lifetime of the instance: drop the rejected promise so the next
    // request retries Upstash.
    captured.catch(() => {
      if (this.scriptSha === captured) {
        this.scriptSha = null;
      }
    });
    return captured;
  }

  private async loadScript(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/script-load`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([FIXED_WINDOW_MULTI_LUA]),
      });
    } catch (cause) {
      throw providerError("retryable", "limit", "Upstash rate limiter is unreachable", cause);
    }
    if (!response.ok) {
      throw providerError(
        "permanent",
        "limit",
        `Upstash rate limiter rejected the fixed-window script (HTTP ${String(response.status)})`,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    const shaSchema = z.object({ result: z.string().min(1) });
    const parsed = shaSchema.safeParse(body);
    if (!parsed.success) {
      throw providerError("malformed_response", "limit", "Upstash rate limiter did not return a script hash");
    }
    return parsed.data.result;
  }

  private toResult(
    windows: readonly [RateLimitWindow, ...RateLimitWindow[]],
    usedCounts: number[],
    nowMs: number,
  ): RateLimitResult {
    const evaluated = windows.map((window, index) => {
      // The script reports a full window as the sentinel `0` (a granted
      // row is always >= 1), so `used === 0` marks this call as blocked.
      const blocked = (usedCounts[index] ?? 0) === 0;
      const usedAfterCommit = blocked ? window.limit : Math.max(1, usedCounts[index] ?? 1);
      return {
        window,
        blocked,
        postRemaining: Math.max(0, window.limit - usedAfterCommit),
        resetAtMs: (Math.floor(nowMs / window.windowMs) + 1) * window.windowMs,
      };
    });

    const tightest = evaluated.reduce((min, entry) =>
      entry.window.limit < min.window.limit ? entry : min,
    );

    if (evaluated.every((entry) => !entry.blocked)) {
      return {
        success: true,
        limit: tightest.window.limit,
        remaining: Math.min(...evaluated.map((entry) => entry.postRemaining)),
        // Every configured window must roll over before all counters are
        // fresh again — matches the fake's shared contract.
        resetAt: new Date(Math.max(...evaluated.map((entry) => entry.resetAtMs))),
      };
    }

    // Failure reset: the earliest instant a retry can succeed is when EVERY
    // window left empty by this call has rolled over — windows already
    // exhausted before it AND windows drained to zero by taking their last
    // slot. Label the result with the window attaining that instant.
    let binding = evaluated.find((entry) => entry.blocked || entry.postRemaining === 0);
    if (!binding) {
      throw providerError("permanent", "limit", "At least one rate limit window is required");
    }
    for (const entry of evaluated) {
      if (
        (entry.blocked || entry.postRemaining === 0) &&
        entry.resetAtMs > binding.resetAtMs
      ) {
        binding = entry;
      }
    }
    return {
      success: false,
      limit: binding.window.limit,
      remaining: 0,
      resetAt: new Date(binding.resetAtMs),
      retryAfterMs: Math.max(0, binding.resetAtMs - nowMs),
    };
  }
}
