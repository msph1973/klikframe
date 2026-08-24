import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../../lib/http/app";
import {
  REQUEST_ID_HEADER,
  isValidRequestId,
} from "../../../lib/http/request-id";
import type { KlikFrameApp } from "../../../lib/http/app";

/**
 * Route-level contract tests for POST /api/v1/onboarding (API_SPEC.md §2,
 * §1.4). These run against the composed Hono app with the identity port
 * stubbed via lib/auth/server setters — no database required. Full
 * database-backed concurrency/rollback scenarios live in
 * tests/integration/onboarding.integration.test.ts.
 */
import {
  setIdentitySessionPort,
} from "../../../lib/auth/server";
import type { IdentitySessionPort, SessionResolution } from "../../../lib/auth/identity-session-port";

const VALID_PAYLOAD = {
  business_name: "Klik Studio",
  slug: "klik-studio",
  owner_display_name: "Ayu",
};

function makeAuthenticatedPort(): IdentitySessionPort {
  return {
    resolveSession() {
      return Promise.resolve({
        kind: "authenticated",
        session: {
          identity: { authUserId: "user_1", email: "owner@example.com" },
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    },
  };
}

function post(app: KlikFrameApp, headers: Record<string, string>, body?: unknown) {
  return app.request("/api/v1/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "itest-0123456789abcdef",
      ...headers,
    },
    body: JSON.stringify(body ?? VALID_PAYLOAD),
  });
}

describe("POST /api/v1/onboarding — HTTP contract", () => {
  afterEach(() => {
    setIdentitySessionPort(new (class implements IdentitySessionPort {
      resolveSession(): Promise<SessionResolution> {
        return Promise.resolve({ kind: "unauthenticated" });
      }
    })());
  });

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
      headers: { "content-type": "application/json" },
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
