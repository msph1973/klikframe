import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "../../../lib/config/env";

describe("loadEnv", () => {
  it("parses a minimal valid environment with defaults applied", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_ORIGIN).toBeUndefined();
  });

  it("accepts a representative sample of documented DEPLOYMENT.md §3 fields when present", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://app.klikframe.id",
      NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
      CRON_SECRET: "b".repeat(32),
      RESEND_FROM_EMAIL: "no-reply@klikframe.id",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.APP_ORIGIN).toBe("https://app.klikframe.id");
    expect(env.CRON_SECRET).toHaveLength(32);
  });

  it("requires UPSTASH_REDIS_REST_URL to be https so the REST token never travels in cleartext", () => {
    expect(() => loadEnv({ UPSTASH_REDIS_REST_URL: "http://example.upstash.io" })).toThrow(
      EnvValidationError,
    );
    expect(loadEnv({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" }).UPSTASH_REDIS_REST_URL).toBe(
      "https://example.upstash.io",
    );
  });

  it("treats a blank .env.example-style value as unset, not invalid", () => {
    const env = loadEnv({ NEON_AUTH_COOKIE_SECRET: "", CRON_SECRET: "c".repeat(32) });
    expect(env.NEON_AUTH_COOKIE_SECRET).toBeUndefined();
    expect(env.CRON_SECRET).toHaveLength(32);
  });

  it("rejects a malformed URL field", () => {
    expect(() => loadEnv({ APP_ORIGIN: "not-a-url" })).toThrow(EnvValidationError);
  });

  it("rejects a secret shorter than the 32-byte minimum", () => {
    expect(() => loadEnv({ CRON_SECRET: "too-short" })).toThrow(EnvValidationError);
  });

  it("ignores unrelated keys instead of failing", () => {
    expect(() => loadEnv({ SOME_UNRELATED_TOOLING_VAR: "x" })).not.toThrow();
  });

  it("surfaces structured issues on EnvValidationError", () => {
    try {
      loadEnv({ APP_ORIGIN: "not-a-url" });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const validationError = error as EnvValidationError;
      expect(validationError.issues.length).toBeGreaterThan(0);
    }
  });

  it("routes deploy metadata (VERCEL_GIT_COMMIT_SHA, npm_package_version) through the same validated boundary", () => {
    const env = loadEnv({ VERCEL_GIT_COMMIT_SHA: "abc123", npm_package_version: "0.1.0" });
    expect(env.VERCEL_GIT_COMMIT_SHA).toBe("abc123");
    expect(env.npm_package_version).toBe("0.1.0");
  });
});
