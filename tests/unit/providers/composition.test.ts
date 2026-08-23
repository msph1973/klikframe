import { describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "../../../lib/config/env";

/**
 * Composition contract (lib/providers/composition.ts): fakes in test
 * runtime, real adapters elsewhere; construction is deterministic and
 * cached. Env fixtures use clearly-fake placeholder values.
 *
 * These suites intentionally use `await import()` for the composition
 * modules: they are `server-only` singletons that capture env through
 * getEnv() during module init, so each test must mutate process.env and
 * reset the env cache BEFORE the module graph loads. Static imports would
 * initialize against whatever env ran first and leak state across tests.
 */
function envAll(): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = ["placeholder", "token", "value"].join("-");
  process.env.RESEND_API_KEY = "re_" + "placeholder_key";
  process.env.RESEND_FROM_EMAIL = "no-reply@" + "klikframe.test";
  process.env.ABLY_API_KEY = "app.placeholder:" + "placeholder-secret";
  process.env.NEON_AUTH_BASE_URL = "https://auth.example-neon.test";
  process.env.AWS_ACCESS_KEY_ID = "AKIA" + "IOSFODNN7" + "EXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-" + "key-not-real";
  process.env.S3_ENDPOINT = "https://objectstore.mum1.civo.com";
  process.env.S3_BUCKET = "klikframe-test-bucket";
  resetEnvCacheForTests();
}

describe("provider composition", () => {
  it("builds a full fake provider set under NODE_ENV=test", async () => {
    envAll();
    const { getProviders, resetProvidersForTests } = await import("../../../lib/providers/composition");
    const providers = getProviders();
    expect(providers.rateLimiter.constructor.name).toBe("FakeRateLimiter");
    expect(providers.storage.constructor.name).toBe("FakeObjectStorage");
    expect(providers.email.constructor.name).toBe("FakeEmailSender");
    expect(providers.realtimePublisher.constructor.name).toBe("FakeRealtimePublisher");
    expect(providers.realtimeTokens.constructor.name).toBe("FakeRealtimeTokenIssuer");
    // Cached: second access returns the same instances.
    expect(getProviders()).toBe(providers);
    resetProvidersForTests();
  });

  it("selects real adapters outside test runtime", async () => {
    envAll();
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    resetEnvCacheForTests();
    const { getProviders, resetProvidersForTests } = await import("../../../lib/providers/composition");
    // The cached set was dropped by resetProvidersForTests(); with NODE_ENV
    // no longer "test" the rebuilt set must contain the REAL adapters.
    const providers = getProviders();
    expect(providers.rateLimiter.constructor.name).toBe("UpstashRestRateLimiter");
    expect(providers.storage.constructor.name).toBe("CivoS3Storage");
    expect(providers.email.constructor.name).toBe("ResendEmailSender");
    expect(providers.realtimePublisher.constructor.name).toBe("AblyRestPublisher");
    expect(providers.realtimeTokens.constructor.name).toBe("AblyTokenIssuer");
    resetProvidersForTests();
  });

  it("wires the deterministic fake port under NODE_ENV=test", async () => {
    envAll();
    const { wireIdentitySessionPort } = await import("../../../lib/providers/composition");
    const { getIdentitySessionPort } = await import("../../../lib/auth/server");
    const { getFakeIdentitySessionPort } = await import(
      "../../../lib/auth/fake-identity-session-port"
    );
    wireIdentitySessionPort();
    const port = getIdentitySessionPort();
    // The TESTING.md §2.2 IdentitySessionPort test adapter — never the
    // real Neon adapter — so unit suites resolve sessions without JWKS
    // network access or NEON_AUTH_BASE_URL provisioning.
    expect(port).toBe(getFakeIdentitySessionPort());
    // Seeding flows through the wired composition point unchanged.
    getFakeIdentitySessionPort().seed({
      kind: "authenticated",
      session: {
        identity: { authUserId: "user-1", email: null },
        issuedAt: new Date(0),
        expiresAt: new Date(1),
      },
    });
    await expect(port.resolveSession(new Request("https://app.example.com/"))).resolves.toMatchObject(
      { kind: "authenticated", session: { identity: { authUserId: "user-1" } } },
    );
    getFakeIdentitySessionPort().seed({ kind: "unauthenticated" });
    await expect(port.resolveSession(new Request("https://app.example.com/"))).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("caches the identity adapter outside test runtime — one shared instance", async () => {
    envAll();
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    resetEnvCacheForTests();
    const { wireIdentitySessionPort } = await import("../../../lib/providers/composition");
    const { getIdentitySessionPort } = await import("../../../lib/auth/server");
    // Cold-start paths (route modules, middleware) may all call this; the
    // real adapter must be constructed ONCE, not rebuilt per call.
    wireIdentitySessionPort();
    const first = getIdentitySessionPort();
    wireIdentitySessionPort();
    expect(getIdentitySessionPort()).toBe(first);
    expect(first.constructor.name).toBe("NeonAuthAdapter");
  });
});
