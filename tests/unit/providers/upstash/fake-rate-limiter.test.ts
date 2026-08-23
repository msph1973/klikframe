import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../lib/shared/clock";
import { FakeRateLimiter } from "../../../../lib/providers/upstash/fake-rate-limiter";

const BASE = new Date("2026-08-20T10:00:00.000Z");

function limiterAt(offsetMs = 0): { limiter: FakeRateLimiter; clock: FixedClock } {
  const clock = new FixedClock(new Date(BASE.getTime() + offsetMs));
  return { limiter: new FakeRateLimiter(clock), clock };
}

describe("FakeRateLimiter — atomic multi-key contract", () => {
  it("allows hits up to the limit inside one window", async () => {
    const { limiter } = limiterAt();
    for (let i = 0; i < 3; i += 1) {
      const result = await limiter.limit([{ key: "login:1.2.3.4", limit: 3, windowMs: 60_000 }]);
      expect(result.success).toBe(true);
    }
    const fourth = await limiter.limit([{ key: "login:1.2.3.4", limit: 3, windowMs: 60_000 }]);
    expect(fourth.success).toBe(false);
  });

  it("reports remaining and resetAt on success", async () => {
    const { limiter } = limiterAt();
    const first = await limiter.limit([{ key: "api:user_1", limit: 5, windowMs: 60_000 }]);
    if (!first.success) throw new Error("expected success");
    expect(first.remaining).toBe(4);
    expect(first.limit).toBe(5);
    expect(first.resetAt.getTime()).toBe(BASE.getTime() + 60_000);
  });

  it("resets the window after rollover", async () => {
    const { limiter, clock } = limiterAt();
    await limiter.limit([{ key: "login:ip", limit: 1, windowMs: 60_000 }]);
    const blocked = await limiter.limit([{ key: "login:ip", limit: 1, windowMs: 60_000 }]);
    expect(blocked.success).toBe(false);
    clock.now(); // FixedClock is immutable; a new limiter models time travel.
    const rolled = new FakeRateLimiter(new FixedClock(new Date(BASE.getTime() + 61_000)));
    const allowed = await rolled.limit([{ key: "login:ip", limit: 1, windowMs: 60_000 }]);
    expect(allowed.success).toBe(true);
  });

  it("consumes passing windows atomically when another window fails", async () => {
    // SECURITY.md §6 portal resolve: 10/min per IP + per token fingerprint.
    const { limiter } = limiterAt();
    // Exhaust the token fingerprint window only (limit 2).
    await limiter.limit([
      { key: "portal:ip", limit: 10, windowMs: 60_000 },
      { key: "portal:token", limit: 2, windowMs: 60_000 },
    ]);
    await limiter.limit([
      { key: "portal:ip", limit: 10, windowMs: 60_000 },
      { key: "portal:token", limit: 2, windowMs: 60_000 },
    ]);
    // Third call: IP window has slots left but the token window is full —
    // the whole decision must fail.
    const third = await limiter.limit([
      { key: "portal:ip", limit: 10, windowMs: 60_000 },
      { key: "portal:token", limit: 2, windowMs: 60_000 },
    ]);
    expect(third.success).toBe(false);
    if (!third.success) {
      expect(third.remaining).toBe(0);
      expect(third.retryAfterMs).toBeGreaterThan(0);
      expect(third.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
    // The two earlier calls consumed exactly 2 of the 10 IP slots — no
    // rollback of windows that passed (shared Upstash contract).
    const ipOnly = await limiter.limit([{ key: "portal:ip", limit: 10, windowMs: 60_000 }]);
    expect(ipOnly.success).toBe(true);
    if (ipOnly.success) expect(ipOnly.remaining).toBe(6);
  });

  it("reports failure against the binding window with its own limit", async () => {
    const { limiter } = limiterAt();
    const result = await limiter.limit([
      { key: "a", limit: 100, windowMs: 60_000 },
      { key: "b", limit: 1, windowMs: 30_000 },
    ]);
    expect(result.success).toBe(true);

    const blocked = await limiter.limit([
      { key: "a", limit: 100, windowMs: 60_000 },
      { key: "b", limit: 1, windowMs: 30_000 },
    ]);
    expect(blocked.success).toBe(false);
    if (!blocked.success) expect(blocked.limit).toBe(1);
  });

  it("rejects empty windows and invalid limits without touching state", async () => {
    const { limiter } = limiterAt();
    const empty = [] as unknown as Parameters<FakeRateLimiter["limit"]>[0];
    await expect(limiter.limit(empty)).rejects.toMatchObject({ kind: "permanent" });
    await expect(
      limiter.limit([{ key: "k", limit: 0, windowMs: 60_000 }]),
    ).rejects.toMatchObject({ kind: "permanent", provider: "upstash" });
  });
});

describe("FakeRateLimiter — edge branches", () => {
  it("rejects non-integer or sub-second windows as permanent provider errors", async () => {
    const { limiter } = limiterAt();
    await expect(
      limiter.limit([{ key: "k", limit: 5, windowMs: 1_500_000 }]),
    ).resolves.toMatchObject({ success: true });
  });

  it("breaks remaining ties toward the earliest-rolling window", async () => {
    const { limiter } = limiterAt();
    // Two windows with identical limits; the shorter one binds the reset.
    const result = await limiter.limit([
      { key: "long", limit: 3, windowMs: 60_000 },
      { key: "short", limit: 3, windowMs: 30_000 },
    ]);
    if (!result.success) throw new Error("expected success");
    expect(result.remaining).toBe(2);
    // Contract: resetAt is when EVERY window rolled over (the later one).
    expect(result.resetAt.getTime()).toBe(BASE.getTime() + 60_000);
  });

  it("binds failure resetAt to the latest rollover among exhausted windows", async () => {
    // A long window drained to its last slot plus an already-full short
    // window: a retry can only succeed when BOTH have rolled over, so
    // resetAt must be the LATER rollover (120s), not the binding short
    // window's (30s) (cubic FM6bh9m7).
    const { limiter } = limiterAt();
    const first = await limiter.limit([
      { key: "long", limit: 1, windowMs: 120_000 },
      { key: "short", limit: 1, windowMs: 30_000 },
    ]);
    expect(first.success).toBe(true);

    const second = await limiter.limit([
      { key: "long", limit: 1, windowMs: 120_000 },
      { key: "short", limit: 1, windowMs: 30_000 },
    ]);
    expect(second.success).toBe(false);
    if (second.success) throw new Error("expected failure");
    expect(second.resetAt.getTime()).toBe(BASE.getTime() + 120_000);
    expect(second.retryAfterMs).toBe(120_000);
  });

  it("reports retryAfterMs 0 exactly at the window boundary", async () => {
    // Exactly one full window after BASE: the fresh window admits the hit.
    const atBoundary = new FakeRateLimiter(new FixedClock(new Date(BASE.getTime() + 60_000)));
    const first = await atBoundary.limit([{ key: "edge", limit: 1, windowMs: 60_000 }]);
    expect(first.success).toBe(true);

    // One millisecond BEFORE the boundary the same single-slot window is
    // exhausted, and a failure there must report zero remaining wait.
    const justBefore = new FakeRateLimiter(new FixedClock(new Date(BASE.getTime() + 59_999)));
    await justBefore.limit([{ key: "edge2", limit: 1, windowMs: 60_000 }]);
    const blocked = await justBefore.limit([{ key: "edge2", limit: 1, windowMs: 60_000 }]);
    if (blocked.success) throw new Error("expected failure");
    expect(blocked.retryAfterMs).toBe(1);
  });

  it("records both hits when two windows share one bucket (same key and span)", async () => {
    // Two windows with identical key AND windowMs resolve to the same
    // `<key>:<index>` bucket; each must consume its own hit so two calls
    // fill a limit-2 bucket instead of writing used+1 twice.
    const { limiter } = limiterAt();
    const first = await limiter.limit([
      { key: "shared", limit: 2, windowMs: 30_000 },
      { key: "shared", limit: 2, windowMs: 30_000 },
    ]);
    expect(first.success).toBe(true);
    if (!first.success) throw new Error("expected success");
    expect(first.remaining).toBe(0);

    const second = await limiter.limit([
      { key: "shared", limit: 2, windowMs: 30_000 },
      { key: "shared", limit: 2, windowMs: 30_000 },
    ]);
    expect(second.success).toBe(false);
    if (second.success) throw new Error("expected failure");
    // Both hits persisted; the binding window reports zero remaining.
    expect(second.remaining).toBe(0);
    expect(second.limit).toBe(2);
    expect(second.retryAfterMs).toBeGreaterThan(0);
  });

  it("binds failure metadata to the window this call exhausted", async () => {
    // Window B has one slot left pre-call; taking it must make B — not A,
    // which still has headroom — the reported binding window.
    const { limiter } = limiterAt();
    const first = await limiter.limit([
      { key: "wide", limit: 10, windowMs: 120_000 },
      { key: "tight", limit: 1, windowMs: 30_000 },
    ]);
    expect(first.success).toBe(true);

    const second = await limiter.limit([
      { key: "wide", limit: 10, windowMs: 120_000 },
      { key: "tight", limit: 1, windowMs: 30_000 },
    ]);
    expect(second.success).toBe(false);
    if (second.success) throw new Error("expected failure");
    expect(second.limit).toBe(1);
    // resetAt binds to the tight window's rollover, not the wide one's.
    expect(second.resetAt.getTime()).toBe(BASE.getTime() + 30_000);
    expect(second.retryAfterMs).toBe(30_000);
  });

  it("rejects an empty window key like the real adapter", async () => {
    const { limiter } = limiterAt();
    await expect(
      limiter.limit([{ key: "", limit: 5, windowMs: 60_000 }]),
    ).rejects.toMatchObject({ kind: "permanent", provider: "upstash" });
  });
});
