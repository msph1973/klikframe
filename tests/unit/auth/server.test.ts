import { NextResponse, type NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAuthProxyHandler,
  getAuthRequestHandler,
  getIdentitySessionPort,
  setAuthProxyHandler,
  setAuthRequestHandler,
  setIdentitySessionPort,
} from "../../../lib/auth/server";
import type { IdentitySessionPort, SessionResolution } from "../../../lib/auth/identity-session-port";

class StubIdentitySessionPort implements IdentitySessionPort {
  resolveSession(): Promise<SessionResolution> {
    return Promise.resolve({ kind: "unauthenticated" });
  }
}

describe("auth composition point", () => {
  afterEach(() => {
    setIdentitySessionPort(new StubIdentitySessionPort());
    setAuthRequestHandler(getAuthRequestHandler());
    setAuthProxyHandler(getAuthProxyHandler());
  });

  it("defaults the auth request handler to a sanitized DEPENDENCY_UNAVAILABLE response", async () => {
    const response = await getAuthRequestHandler()(new Request("https://example.com/api/auth/get-session"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("defaults the auth proxy handler to a passthrough", () => {
    // Default handler ignores the request entirely; a minimal Request
    // stands in for NextRequest here (no NextRequest constructor exists
    // outside a Next.js server runtime).
    const fakeRequest = new Request("https://example.com/dashboard") as unknown as NextRequest;
    const result = getAuthProxyHandler()(fakeRequest);
    expect(result).toBeInstanceOf(NextResponse);
  });

  it("lets a later wave swap in a real identity session port", async () => {
    const custom: IdentitySessionPort = {
      resolveSession: () =>
        Promise.resolve({
          kind: "authenticated",
          session: {
            identity: { authUserId: "user_1", email: "owner@example.com" },
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
    };
    setIdentitySessionPort(custom);
    const resolution = await getIdentitySessionPort().resolveSession(new Request("https://example.com/"));
    expect(resolution.kind).toBe("authenticated");
  });
});
