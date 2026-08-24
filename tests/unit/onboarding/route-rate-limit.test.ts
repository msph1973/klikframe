import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../lib/http/app";
import { setIdentitySessionPort } from "../../../lib/auth/server";
import type { IdentitySessionPort } from "../../../lib/auth/identity-session-port";
import { resetEnvCacheForTests } from "../../../lib/config/env";
import {
  getProviders,
  resetProvidersForTests,
} from "../../../lib/providers/composition";
import type { RateLimitResult } from "../../../lib/providers/upstash/rate-limit-port";

/**
 * Rate-limit contract on POST /api/v1/onboarding (API_SPEC.md §1.5):
 * 100/min per auth user ID, evaluated AFTER session resolution (the key is
 * the auth user ID) and BEFORE payload parsing/use-case work. A blocked
 * request yields the frozen 429 RATE_LIMITED envelope with Retry-After.
 */

const APP_ORIGIN = "https://app.klikframe.example";

const VALID_PAYLOAD = {
  business_name: "Klik Studio",
  slug: "klik-studio",
  owner_display_name: "Ayu",
};

/** Deterministic limiter stub returning a canned result verbatim. */
class StubRateLimiter {
  lastWindows: readonly unknown[] | undefined;
  constructor(private result: RateLimitResult) {}
  limit(windows: readonly unknown[]): Promise<RateLimitResult> {
    this.lastWindows = windows;
    return Promise.resolve(this.result);
  }
}

let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  previousEnv = {
    APP_ORIGIN: process.env.APP_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  (process.env as Record<string, string | undefined>).APP_ORIGIN = APP_ORIGIN;
  resetEnvCacheForTests();
});

afterEach(() => {
  const record = process.env as Record<string, string | undefined>;
  if (previousEnv.APP_ORIGIN === undefined) delete record.APP_ORIGIN;
  else record.APP_ORIGIN = previousEnv.APP_ORIGIN;
  if (previousEnv.NODE_ENV === undefined) delete record.NODE_ENV;
  else record.NODE_ENV = previousEnv.NODE_ENV;
  resetEnvCacheForTests();
  setIdentitySessionPort(new (class implements IdentitySessionPort {
    resolveSession(): Promise<{ kind: "unauthenticated" }> {
      return Promise.resolve({ kind: "unauthenticated" });
    }
  })());
  resetProvidersForTests();
});

function seedAuthenticatedSession(): void {
  setIdentitySessionPort({
    resolveSession() {
      return Promise.resolve({
        kind: "authenticated" as const,
        session: {
          identity: { authUserId: "user_rl", email: "owner@example.com" },
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    },
  });
}

function post(app: ReturnType<typeof createApp>): Promise<Response> {
  const pending = app.request("/api/v1/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_ORIGIN,
      "idempotency-key": "itest-0123456789abcdef",
    },
    body: JSON.stringify(VALID_PAYLOAD),
  });
  return Promise.resolve(pending);
}

describe("POST /api/v1/onboarding — rate limit (API_SPEC.md §1.5)", () => {
  it("returns 429 RATE_LIMITED with Retry-After when the window is exhausted", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    seedAuthenticatedSession();
    // Replace the composed fake limiter with a deterministic failure so the
    // test does not depend on hit counts.
    const providers = getProviders() as { rateLimiter: unknown };
    providers.rateLimiter = new StubRateLimiter({
      success: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date(Date.now() + 23_400),
      retryAfterMs: 23_400,
    });
    const app = createApp();
    const res = await post(app);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; request_id: string | null } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.request_id).not.toBeNull();
    // Retry-After is whole seconds, rounded UP — a client retrying at
    // exactly that delay must not still be blocked.
    expect(res.headers.get("Retry-After")).toBe("24");
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBe("0");
  });

  it("keys the window by the authenticated principal", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    seedAuthenticatedSession();
    const limiter = new StubRateLimiter({ success: true, limit: 100, remaining: 99, resetAt: new Date(Date.now() + 60_000) });
    const providers = getProviders() as { rateLimiter: unknown };
    providers.rateLimiter = limiter;
    const app = createApp();
    // The request proceeds past the limiter into database work, which this
    // unit environment cannot serve — but the assertion below proves the
    // limiter RAN with the right key before anything else happened.
    await post(app).catch(() => undefined);
    expect(limiter.lastWindows).toBeDefined();
    const windows = limiter.lastWindows as readonly { key: string; limit: number; windowMs: number }[];
    expect(windows).toHaveLength(1);
    expect(windows[0]?.key).toBe("owner-api:user_rl");
    expect(windows[0]?.limit).toBe(100);
    expect(windows[0]?.windowMs).toBe(60_000);
  });
});
