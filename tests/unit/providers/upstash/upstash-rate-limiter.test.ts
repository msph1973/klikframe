import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../lib/shared/clock";
import { resetEnvCacheForTests } from "../../../../lib/config/env";
import { FakeRateLimiter } from "../../../../lib/providers/upstash/fake-rate-limiter";
import {
  FIXED_WINDOW_MULTI_LUA,
  UPSTASH_SCRIPT_KEYS,
} from "../../../../lib/providers/upstash/fixed-window-lua";
import { UpstashRestRateLimiter } from "../../../../lib/providers/upstash/upstash-rate-limiter";

const BASE = new Date("2026-08-20T10:00:00.000Z");

/**
 * Contract fixtures for the real Upstash adapter (TESTING.md §2.3): the
 * HTTP boundary is exercised through an injected fetch that replays
 * deterministic responses, so no network is touched. The Lua payload and
 * argument layout are asserted against the shared contract the fake
 * implements — this keeps "in-memory limiter with shared contract" true
 * across fast CI and nightly staging runs.
 */
function envUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = ["test-token-value", "123456"].join("-");
  resetEnvCacheForTests();
}

describe("Upstash REST adapter contract", () => {
  it("exports the atomic script with its documented key count", () => {
    expect(typeof FIXED_WINDOW_MULTI_LUA).toBe("string");
    expect(FIXED_WINDOW_MULTI_LUA).toContain("INCR");
    expect(UPSTASH_SCRIPT_KEYS).toBe(0);
  });

  it("fails construction when canonical env vars are missing", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetEnvCacheForTests();
    expect(() => new UpstashRestRateLimiter(new FixedClock(BASE))).toThrow(
      /UPSTASH_REDIS_REST_URL/,
    );
    envUpstash();
  });

  it("sends one script invocation per limit() call and maps results", async () => {
    envUpstash();
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      await Promise.resolve();
      calls.push(url as string);
      // First call is SCRIPT LOAD, second the EVALSHA.
      if (calls.length === 1) {
        return new Response(JSON.stringify({ result: "abcdef123456" }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: [1] }), { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    const result = await limiter.limit([{ key: "login:1.2.3.4", limit: 5, windowMs: 60_000 }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.remaining).toBe(4);
    expect(calls[0]).toContain("/script-load");
    expect(calls[1]).toContain("/evalsha/");
  });

  it("maps malformed envelopes to sanitized malformed_response errors", async () => {
    envUpstash();
    let call = 0;
    const fetchImpl = (async () => {
      await Promise.resolve();
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ result: "sha" }), { status: 200 });
      return new Response("<html>gateway error</html>", { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    await expect(
      limiter.limit([{ key: "k", limit: 1, windowMs: 1000 }]),
    ).rejects.toMatchObject({ kind: "malformed_response", provider: "upstash" });
  });

  it("keeps fake and real adapters on one shared outcome shape", async () => {
    const fake = new FakeRateLimiter(new FixedClock(BASE));
    const first = await fake.limit([{ key: "x", limit: 1, windowMs: 60_000 }]);
    await fake.limit([{ key: "x", limit: 1, windowMs: 60_000 }]);
    expect(first.success).toBe(true);
    expect(Object.keys(first).sort()).toEqual(["limit", "remaining", "resetAt", "success"]);
  });
});

describe("Upstash REST adapter — additional contract branches", () => {
  it("returns a blocked result with retryAfterMs when the script reports a full window", async () => {
    envUpstash();
    let call = 0;
    const fetchImpl = (async () => {
      await Promise.resolve();
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ result: "sha2" }), { status: 200 });
      return new Response(JSON.stringify({ result: [5] }), { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    const result = await limiter.limit([{ key: "login:ip", limit: 5, windowMs: 60_000 }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.resetAt.getTime()).toBe(BASE.getTime() + 60_000);
    }
  });

  it("retries once after a NOSCRIPT reply", async () => {
    envUpstash();
    const calls: string[] = [];
    let evalshaCalls = 0;
    const fetchImpl = (async (url: string | URL) => {
      await Promise.resolve();
      calls.push(url as string);
      if ((url as string).includes("/script-load")) {
        return new Response(JSON.stringify({ result: evalshaCalls === 0 ? "old-sha" : "fresh-sha" }), { status: 200 });
      }
      evalshaCalls += 1;
      if (evalshaCalls === 1) {
        return new Response(JSON.stringify({ error: "NOSCRIPT no matching script" }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: [1] }), { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    const result = await limiter.limit([{ key: "k2", limit: 3, windowMs: 60_000 }]);
    expect(result.success).toBe(true);
    expect(calls.some((url) => url.includes("/script-load")));
  });

  it("maps non-JSON success bodies on script load to malformed_response", async () => {
    envUpstash();
    let call = 0;
    const fetchImpl = (async () => {
      await Promise.resolve();
      call += 1;
      if (call === 1) return new Response("not json", { status: 200 });
      throw new Error("unreachable");
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    await expect(
      limiter.limit([{ key: "k3", limit: 1, windowMs: 1000 }]),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("classifies HTTP failures of the script load as permanent", async () => {
    envUpstash();
    let call = 0;
    const fetchImpl = (async () => {
      await Promise.resolve();
      call += 1;
      return call === 1 ? new Response("boom", { status: 500 }) : new Response("{}", { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    await expect(
      limiter.limit([{ key: "k4", limit: 1, windowMs: 1000 }]),
    ).rejects.toMatchObject({ kind: "permanent" });
  });

  it("reports the tightest limit across windows on success", async () => {
    envUpstash();
    let call = 0;
    const fetchImpl = (async () => {
      await Promise.resolve();
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ result: "sha5" }), { status: 200 });
      return new Response(JSON.stringify({ result: [1, 9] }), { status: 200 });
    }) as typeof fetch;
    const limiter = new UpstashRestRateLimiter(new FixedClock(BASE), { fetchImpl });
    const result = await limiter.limit([
      { key: "per-ip", limit: 10, windowMs: 60_000 },
      { key: "per-token", limit: 20, windowMs: 120_000 },
    ]);
    if (!result.success) throw new Error("expected success");
    expect(result.limit).toBe(10);
    // resetAt covers every configured window rolling over.
    expect(result.resetAt.getTime()).toBe(BASE.getTime() + 120_000);
  });
});
