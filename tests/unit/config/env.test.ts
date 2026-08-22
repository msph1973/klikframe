import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "../../../lib/config/env";

describe("loadEnv", () => {
  it("parses a minimal valid environment with defaults applied", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_ORIGIN).toBeUndefined();
  });

  it("accepts every canonical DEPLOYMENT.md §3 field when present", () => {
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
});
