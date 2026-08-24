import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertSameOrigin,
  trustedOriginFromEnv,
} from "../../../lib/http/origin";
import { AppError } from "../../../lib/http/errors";
import { resetEnvCacheForTests } from "../../../lib/config/env";
import type { Env } from "../../../lib/config/env";

/**
 * Origin guard unit coverage (API_SPEC.md §1.6): cookie-authenticated
 * mutations accept ONLY the exact configured APP_ORIGIN; foreign, absent,
 * `null`, and malformed Origins are denied with ORIGIN_DENIED, and an
 * unset APP_ORIGIN fails closed.
 */
function envWith(APP_ORIGIN: string | undefined): Pick<Env, "APP_ORIGIN"> {
  return APP_ORIGIN === undefined ? { APP_ORIGIN: undefined } : { APP_ORIGIN };
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://app.klikframe.example/api/v1/onboarding", {
    method: "POST",
    headers,
  });
}

let previousEnv: string | undefined;

beforeEach(() => {
  previousEnv = process.env.APP_ORIGIN;
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousEnv;
  resetEnvCacheForTests();
});

describe("trustedOriginFromEnv", () => {
  it("normalizes scheme+host+port, stripping any path", () => {
    expect(trustedOriginFromEnv(envWith("https://app.example/some/path"))).toBe("https://app.example");
  });

  it("returns null when APP_ORIGIN is unset or unparsable", () => {
    expect(trustedOriginFromEnv(envWith(undefined))).toBeNull();
    expect(trustedOriginFromEnv(envWith("not-a-url"))).toBeNull();
  });
});

describe("assertSameOrigin", () => {
  it("accepts the exact configured origin", () => {
    expect(() => {
      assertSameOrigin(requestWith({ Origin: "https://app.example" }), envWith("https://app.example"));
    }).not.toThrow();
  });

  it.each([
    ["foreign", "https://evil.example"],
    ["null token", "null"],
    ["NULL uppercase", "NULL"],
    ["unparsable garbage", "::not a url::"],
    // PRRT_kwDOT_C_FM6bspCT: a serialized origin never carries a path,
    // query, fragment, or credentials — each must deny even when the host
    // matches the configured origin.
    ["path on trusted host", "https://app.example/evil/path"],
    ["query on trusted host", "https://app.example?q=1"],
    ["fragment on trusted host", "https://app.example#frag"],
    ["credentials on trusted host", "https://user:pass@app.example"],
    ["userinfo without password", "https://user@app.example"],
  ])("denies a %s Origin with ORIGIN_DENIED", (_name, origin) => {
    try {
      assertSameOrigin(requestWith({ Origin: origin }), envWith("https://app.example"));
      expect.unreachable("guard must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("ORIGIN_DENIED");
      expect((error as AppError).status).toBe(403);
    }
  });

  it("denies an absent Origin with ORIGIN_DENIED", () => {
    try {
      assertSameOrigin(requestWith({}), envWith("https://app.example"));
      expect.unreachable("guard must throw");
    } catch (error) {
      expect((error as AppError).code).toBe("ORIGIN_DENIED");
    }
  });

  it("fails closed when APP_ORIGIN is unset — even a matching-looking request is foreign", () => {
    try {
      assertSameOrigin(requestWith({ Origin: "https://anything.example" }), envWith(undefined));
      expect.unreachable("guard must throw");
    } catch (error) {
      expect((error as AppError).code).toBe("ORIGIN_DENIED");
    }
  });
});
