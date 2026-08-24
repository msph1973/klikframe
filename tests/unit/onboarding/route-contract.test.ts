import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../lib/http/app";
import {
  REQUEST_ID_HEADER,
  isValidRequestId,
} from "../../../lib/http/request-id";
import type { KlikFrameApp } from "../../../lib/http/app";

/**
 * Route-level contract tests for POST /api/v1/onboarding (API_SPEC.md §2,
 * §1.4, §1.5, §1.6). These run against the composed Hono app with the
 * identity port stubbed via lib/auth/server setters — no database required.
 * Full database-backed concurrency/rollback scenarios live in
 * tests/integration/onboarding.integration.test.ts.
 */
import { resetEnvCacheForTests } from "../../../lib/config/env";
import {
  setIdentitySessionPort,
} from "../../../lib/auth/server";
import type { IdentitySessionPort, SessionResolution } from "../../../lib/auth/identity-session-port";
import { resetProvidersForTests } from "../../../lib/providers/composition";

const VALID_PAYLOAD = {
  business_name: "Klik Studio",
  slug: "klik-studio",
  owner_display_name: "Ayu",
};

/** Same-origin Origin header every happy-path request in this suite sends. */
const APP_ORIGIN = "https://app.klikframe.example";

let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  previousEnv = { APP_ORIGIN: process.env.APP_ORIGIN };
  (process.env as Record<string, string | undefined>).APP_ORIGIN = APP_ORIGIN;
  resetEnvCacheForTests();
});

afterEach(() => {
  const record = process.env as Record<string, string | undefined>;
  if (previousEnv.APP_ORIGIN === undefined) delete record.APP_ORIGIN;
  else record.APP_ORIGIN = previousEnv.APP_ORIGIN;
  resetEnvCacheForTests();
  setIdentitySessionPort(new (class implements IdentitySessionPort {
    resolveSession(): Promise<SessionResolution> {
      return Promise.resolve({ kind: "unauthenticated" });
    }
  })());
  resetProvidersForTests();
});

function makeAuthenticatedPort(authUserId = "user_1"): IdentitySessionPort {
  return {
    resolveSession() {
      return Promise.resolve({
        kind: "authenticated",
        session: {
          identity: { authUserId, email: "owner@example.com" },
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    },
  };
}

function post(app: KlikFrameApp, headers: Record<string, string>, body?: unknown) {
  // A value of "" removes the header entirely — used to simulate an ABSENT
  // Origin (the guard's deny-by-default case), which a spread cannot do.
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries({
    "content-type": "application/json",
    origin: APP_ORIGIN,
    "idempotency-key": "itest-0123456789abcdef",
    ...headers,
  })) {
    if (value !== "") merged[name] = value;
  }
  return app.request("/api/v1/onboarding", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body ?? VALID_PAYLOAD),
  });
}

describe("POST /api/v1/onboarding — HTTP contract", () => {
  it("rejects unauthenticated requests with a 401 AUTH_REQUIRED envelope", async () => {
    const app = createApp();
    const res = await post(app, {});
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; request_id: string | null } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(isValidRequestId(body.error.request_id)).toBe(true);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(body.error.request_id);
  });

  it("requires an Idempotency-Key header", async () => {
    setIdentitySessionPort(makeAuthenticatedPort());
    const app = createApp();
    const res = await app.request("/api/v1/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toContain("Idempotency-Key");
  });

  it.each([
    ["slug uppercase", { business_name: "X", slug: "Klik", owner_display_name: "A" }],
    ["missing business_name", { slug: "x-y" }],
    ["bad phone format", { business_name: "X", slug: "x-y-z", owner_display_name: "A", phone_e164: "08123" }],
  ])("rejects invalid payload %s with 400 INVALID_INPUT + details", async (_name, payload) => {
    setIdentitySessionPort(makeAuthenticatedPort());
    const app = createApp();
    const res = await post(app, {}, payload);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(body.error.details)).toBe(true);
  });
});

describe("POST /api/v1/onboarding — Origin guard (API_SPEC.md §1.6)", () => {
  it.each([
    ["foreign origin", { origin: "https://evil.example" }],
    ["null origin", { origin: "null" }],
    // "" removes the default Origin entirely: the ABSENT-Origin deny case.
    ["absent origin", { origin: "" }],
  ])("rejects %s with 403 ORIGIN_DENIED before session work", async (_name, headers) => {
    // The session port stays at its unauthenticated default on purpose:
    // if the guard ran after session resolution the response would be 401,
    // not 403 — this pins the ordering contract (guard first).
    let resolveCalls = 0;
    setIdentitySessionPort({
      resolveSession() {
        resolveCalls += 1;
        return Promise.resolve({ kind: "authenticated" as const, session: {
          identity: { authUserId: "user_1", email: null },
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        } });
      },
    });
    const app = createApp();
    const res = await post(app, headers);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; request_id: string | null } };
    expect(body.error.code).toBe("ORIGIN_DENIED");
    expect(isValidRequestId(body.error.request_id)).toBe(true);
    expect(resolveCalls).toBe(0);
  });

  it("denies every mutation when APP_ORIGIN is unset (fail closed)", async () => {
    (process.env as Record<string, string | undefined>).APP_ORIGIN = "";
    delete process.env.APP_ORIGIN;
    resetEnvCacheForTests();
    setIdentitySessionPort(makeAuthenticatedPort());
    const app = createApp();
    const res = await post(app, {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORIGIN_DENIED");
  });

  it("accepts a configured origin that differs only by trailing slash", async () => {
    // APP_ORIGIN=https://host/path normalizes to scheme://authority; a
    // browser-sent bare Origin must match it exactly afterwards.
    (process.env as Record<string, string | undefined>).APP_ORIGIN = `${APP_ORIGIN}/`;
    resetEnvCacheForTests();
    let resolveCalls = 0;
    setIdentitySessionPort({
      resolveSession() {
        resolveCalls += 1;
        return makeAuthenticatedPort().resolveSession(new Request("https://x/"));
      },
    });
    const app = createApp();
    const res = await post(app, {});
    // The request passes the guard (session resolved) and proceeds into
    // database territory — which fails here because no DB is configured in
    // this unit suite. Any outcome AFTER session resolution is fine; the
    // assertion is that it did NOT die with 403 ORIGIN_DENIED.
    expect(res.status).not.toBe(403);
    expect(resolveCalls).toBe(1);
  });
});
