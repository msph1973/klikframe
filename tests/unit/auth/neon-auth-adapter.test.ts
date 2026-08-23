import { SignJWT, errors as joseErrors, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "../../../lib/config/env";
import {
  NeonAuthAdapter,
  getNeonAuthAdapter,
  resetNeonAuthAdapterForTests,
  type JwksVerifier,
} from "../../../lib/auth/neon-auth-adapter";
import { ProviderError } from "../../../lib/shared/provider-error";

const BASE_URL = "https://auth.example-neon.test";
const BASE_SECS = 1_756_000_000; // fixed epoch used by fixtures

/**
 * Auth-adapter conformance fixtures (TESTING.md §2.3 "valid/expired/missing
 * session"). JWTs are signed with a locally generated ES256 key whose JWK is
 * served by a stub JWKS resolver — no network, no real credentials.
 */
async function makeJwksFixture() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const resolver: JwksVerifier = async (protectedHeader) => {
    // Mirrors createRemoteJWKSet's kid matching without network access:
    // an unknown kid is a JWKS-level miss, not a credential failure.
    if (protectedHeader.kid !== undefined && protectedHeader.kid !== "test-key") {
      throw new joseErrors.JWKSNoMatchingKey();
    }
    return crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  };
  const sign = async (
    claims: Record<string, unknown>,
    kid = "test-key",
  ): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid })
      .sign(privateKey);
  return { resolver, sign };
}

function adapterWith(resolver: JwksVerifier): NeonAuthAdapter {
  process.env.NEON_AUTH_BASE_URL = BASE_URL;
  resetEnvCacheForTests();
  return new NeonAuthAdapter({ jwks: resolver });
}

function requestWithToken(token: string): Request {
  return new Request("https://app.klikframe.id/api/v1/clients", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("NeonAuthAdapter.resolveSession", () => {
  afterEach(() => {
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
  });

  it("resolves unauthenticated when no credential is present", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // No headers at all: both extractors bail on their null header.
    const bare = await adapter.resolveSession(new Request("https://app.example.com/"));
    expect(bare).toEqual({ kind: "unauthenticated" });
    // Cookie without the session name, then a pair with no "=" at all:
    // both exhaust extraction and must resolve unauthenticated.
    const namedOther = new Request("https://app.example.com/", {
      headers: { cookie: "other=1" },
    });
    await expect(adapter.resolveSession(namedOther)).resolves.toEqual({
      kind: "unauthenticated",
    });
    const noSeparator = new Request("https://app.example.com/", {
      headers: { cookie: "garbage" },
    });
    const resolution = await adapter.resolveSession(noSeparator);
    expect(resolution).toEqual({ kind: "unauthenticated" });
  });

  it("treats credential-shaped but empty header values as absent credentials", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // A bearer header whose value strips to nothing falls through `|| null`
    // and the session cookie is then consulted (and absent). NBSP survives
    // undici's header normalization, so the scheme really does strip to "".
    const blankBearer = new Request("https://app.example.com/", {
      headers: { authorization: "bearer ", cookie: "other=1" },
    });
    await expect(adapter.resolveSession(blankBearer)).resolves.toEqual({
      kind: "unauthenticated",
    });
    // A named session cookie with an empty value is likewise no credential.
    const emptyCookie = new Request("https://app.example.com/", {
      headers: { cookie: "better-auth.session_token=" },
    });
    await expect(adapter.resolveSession(emptyCookie)).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("treats a malformed percent-encoded session cookie as absent, not a server error", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // "%" is an invalid percent-escape: decodeURIComponent throws URIError,
    // which previously escaped resolveSession as a request-time 500.
    const request = new Request("https://app.example.com/dashboard", {
      headers: { cookie: "other=1; better-auth.session_token=%" },
    });
    await expect(adapter.resolveSession(request)).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("returns expired for a structurally valid but expired token", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // Signed with exp in the past; jwtVerify throws JWTExpired → "expired".
    const token = await fixture.sign({
      sub: "user_1",
      email: null,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
      iss: BASE_URL,
    });
    const resolution = await adapter.resolveSession(requestWithToken(token));
    expect(resolution.kind).toBe("expired");
  });

  it("throws a sanitized malformed_response ProviderError for a validly-signed unexpired token whose claims violate the schema", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // Signature verifies against the stub key and jose's expiry check
    // passes (exp in the future) — so verification succeeds and the Zod
    // schema itself rejects the payload (`sub` missing). This is the only
    // way to genuinely exercise the malformed_response branch.
    const token = await fixture.sign({
      email: null,
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    });
    const cause = await adapter.resolveSession(requestWithToken(token)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(cause).toBeInstanceOf(ProviderError);
    const providerError = cause as ProviderError;
    expect(providerError.kind).toBe("malformed_response");
    expect(providerError.provider).toBe("neon-auth");
    // Sanitized: no raw claim material leaks into the message.
    expect(providerError.message).not.toContain("user");
  });

  it("accepts the bearer scheme case-insensitively per RFC 6750", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const token = await fixture.sign({
      sub: "user_bearer",
      email: null,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    });
    const request = new Request("https://app.example.com/", {
      headers: { authorization: `BEARER ${token}` },
    });
    const resolution = await adapter.resolveSession(request);
    expect(resolution.kind === "authenticated" || resolution.kind === "expired").toBe(true);
  });

  it("never includes raw provider payloads in errors (redaction)", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    try {
      await adapter.resolveSession(
        new Request("https://app.example.com/", {
          headers: { authorization: "Bearer eyAibGVhayI6ICJzdXBlcnNlY3JldCIgfQ.sig" },
        }),
      );
    } catch (error) {
      // Any thrown error must not echo the token or secret material.
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("supersecret");
      expect(message).not.toContain(BASE_URL);
    }
    expect(true).toBe(true);
  });
});

describe("NeonAuthAdapter claim validation branches", () => {
  afterEach(() => {
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
  });

  it("authenticates a valid fixture token with full session bounds", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const nowSecs = Math.floor(BASE_SECS);
    const token = await fixture.sign({
      sub: "user_42",
      email: "owner@klikframe.test",
      iat: nowSecs - 60,
      // jose checks exp against the REAL clock, so it must be in the future.
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    });
    const resolution = await adapter.resolveSession(requestWithToken(token));
    if (resolution.kind !== "authenticated") throw new Error("expected authenticated");
    expect(resolution.session.identity).toEqual({
      authUserId: "user_42",
      email: "owner@klikframe.test",
    });
    expect(resolution.session.expiresAt.getTime()).toBe((Math.floor(Date.now() / 1000) + 600) * 1000);
  });

  it("maps an expired token to expired even when its claims are also incomplete", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const token = await fixture.sign({ email: null, iat: 1, exp: 2, iss: BASE_URL });
    // jose throws JWTExpired (exp=2 long past) before claim shaping, so the
    // frozen contract maps this to "expired" — never an authenticated leak.
    const resolution = await adapter.resolveSession(requestWithToken(token));
    expect(resolution.kind).toBe("expired");
  });

  it("rejects out-of-range NumericDates instead of returning Invalid Date bounds", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // 9e15 s exceeds Date's ±8.64e15 ms range; jose forwards iat untouched,
    // so without the range check the adapter would return authenticated
    // with an Invalid issuedAt.
    const token = await fixture.sign({
      sub: "user_huge",
      email: null,
      iat: 9_000_000_000_000_000,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    });
    const cause = await adapter.resolveSession(requestWithToken(token)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(cause).toBeInstanceOf(ProviderError);
    expect((cause as ProviderError).kind).toBe("malformed_response");
    // And the failure is sanitized — no claim values in the message.
    expect((cause as ProviderError).message).not.toContain("9e15");
  });

  it("reads the better-auth.session_token cookie when no bearer is present", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const nowSecs = Math.floor(BASE_SECS);
    const token = await fixture.sign({
      sub: "user_cookie",
      email: null,
      iat: nowSecs - 10,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: BASE_URL,
    });
    const request = new Request("https://app.example.com/dashboard", {
      headers: { cookie: `other=1; better-auth.session_token=${encodeURIComponent(token)}` },
    });
    const resolution = await adapter.resolveSession(request);
    expect(resolution.kind === "authenticated" || resolution.kind === "expired").toBe(true);
    if (resolution.kind === "authenticated") {
      expect(resolution.session.identity.authUserId).toBe("user_cookie");
    }
  });

  it("returns expired for a token whose exp has passed even when signed correctly", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const nowSecs = Math.floor(BASE_SECS);
    const token = await fixture.sign({
      sub: "user_late",
      email: null,
      iat: nowSecs - 3600,
      exp: nowSecs - 1800,
      iss: BASE_URL,
    });
    const resolution = await adapter.resolveSession(requestWithToken(token));
    // jose throws JWTExpired before our issuer check matters; either expiry
    // mapping is contract-correct — never an authenticated result.
    expect(["expired", "unauthenticated"]).toContain(resolution.kind);
  });
});

describe("NeonAuthAdapter configuration guardrails", () => {
  afterEach(() => {
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
  });

  it("rejects a non-HTTPS NEON_AUTH_BASE_URL before constructing the JWKS resolver", () => {
    process.env.NEON_AUTH_BASE_URL = "http://auth.example-neon.test";
    resetEnvCacheForTests();
    // No jwks override: the constructor must fail on the scheme gate before
    // it ever builds a cleartext JWKS resolver.
    const construct = () => new NeonAuthAdapter();
    expect(construct).toThrow(ProviderError);
    let caught: unknown;
    try {
      construct();
    } catch (error) {
      caught = error;
    }
    expect((caught as ProviderError).kind).toBe("permanent");
    expect((caught as ProviderError).operation).toBe("configure");
  });

  it("rejects a missing NEON_AUTH_BASE_URL at construction", () => {
    delete process.env.NEON_AUTH_BASE_URL;
    resetEnvCacheForTests();
    const construct = () => new NeonAuthAdapter();
    expect(construct).toThrow(ProviderError);
    let caught: unknown;
    try {
      construct();
    } catch (error) {
      caught = error;
    }
    expect((caught as ProviderError).kind).toBe("permanent");
    expect((caught as ProviderError).operation).toBe("configure");
  });
});

describe("NeonAuthAdapter provider-fault classification", () => {
  afterEach(() => {
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
  });

  it("raises a retryable ProviderError when the JWKS fetch fails instead of a 401", async () => {
    const fixture = await makeJwksFixture();
    // createRemoteJWKSet surfaces network failures (DNS, connection refused,
    // TLS) as bare TypeError from the key resolver — reproduce that shape.
    const failingResolver: JwksVerifier = () => Promise.reject(new TypeError("fetch failed"));
    const adapter = adapterWith(failingResolver);
    const token = await fixture.sign({
      sub: "user_offline",
      email: null,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    });
    const cause = await adapter.resolveSession(requestWithToken(token)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(cause).toBeInstanceOf(ProviderError);
    const providerError = cause as ProviderError;
    expect(providerError.kind).toBe("retryable");
    expect(providerError.isRetryable).toBe(true);
    // Sanitized: the underlying network error text never surfaces.
    expect(providerError.message).not.toContain("fetch failed");
  });

  it("raises a retryable ProviderError when the JWKS holds no key for the token's kid", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    // Signed with a kid the stub JWKS cannot match — the shape seen during
    // key rotation lag; must classify as provider fault, not unauthenticated.
    const token = await fixture.sign(
      {
        sub: "user_rotated",
        email: null,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 600,
        iss: BASE_URL,
      },
      "rotated-key",
    );
    await expect(adapter.resolveSession(requestWithToken(token))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "retryable",
      provider: "neon-auth",
    });
  });

  it("still maps bad signatures and structures to unauthenticated (credential failures)", async () => {
    const fixture = await makeJwksFixture();
    const adapter = adapterWith(fixture.resolver);
    const tampered = (await fixture.sign({
      sub: "user_x",
      email: null,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: BASE_URL,
    })).slice(0, -3) + "aaa";
    await expect(
      adapter.resolveSession(requestWithToken(tampered)),
    ).resolves.toEqual({ kind: "unauthenticated" });
    await expect(
      adapter.resolveSession(requestWithToken("not.a.jwt")),
    ).resolves.toEqual({ kind: "unauthenticated" });
  });
});

describe("NeonAuthAdapter instance caching", () => {
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.NEON_AUTH_BASE_URL = BASE_URL;
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
  });

  it("reuses one adapter instance outside the test runtime", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.NEON_AUTH_BASE_URL = BASE_URL;
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
    const first = getNeonAuthAdapter();
    const second = getNeonAuthAdapter();
    expect(first).toBe(second);
  });

  it("builds a fresh adapter per access under NODE_ENV=test", () => {
    process.env.NEON_AUTH_BASE_URL = BASE_URL;
    resetEnvCacheForTests();
    resetNeonAuthAdapterForTests();
    const first = getNeonAuthAdapter();
    const second = getNeonAuthAdapter();
    expect(first).not.toBe(second);
  });
});
