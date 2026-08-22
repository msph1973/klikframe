import { describe, expect, it } from "vitest";
import { ProviderError } from "../../../lib/shared/provider-error";

describe("ProviderError", () => {
  it("threads provider/operation context and cause", () => {
    const cause = new Error("raw sdk failure");
    const error = new ProviderError(
      "timeout",
      { provider: "ably", operation: "publish" },
      "Ably publish timed out",
      { cause },
    );
    expect(error.name).toBe("ProviderError");
    expect(error.provider).toBe("ably");
    expect(error.operation).toBe("publish");
    expect(error.cause).toBe(cause);
  });

  it.each([
    ["timeout", true],
    ["retryable", true],
    ["permanent", false],
    ["malformed_response", false],
    ["unauthorized", false],
  ] as const)("treats kind=%s as retryable=%s", (kind, retryable) => {
    const error = new ProviderError(kind, { provider: "resend", operation: "send" }, "failure");
    expect(error.isRetryable).toBe(retryable);
  });
});
