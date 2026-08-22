import { describe, expect, it } from "vitest";
import { AppError, ERROR_STATUS_MAP, toErrorEnvelope } from "../../../lib/http/errors";

describe("AppError", () => {
  it("maps each error code to its API_SPEC.md §1.2 HTTP status", () => {
    expect(ERROR_STATUS_MAP.INVALID_INPUT).toBe(400);
    expect(ERROR_STATUS_MAP.AUTH_REQUIRED).toBe(401);
    expect(ERROR_STATUS_MAP.ORIGIN_DENIED).toBe(403);
    expect(ERROR_STATUS_MAP.RESOURCE_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS_MAP.IDEMPOTENCY_CONFLICT).toBe(409);
    expect(ERROR_STATUS_MAP.UPLOAD_EXPIRED).toBe(410);
    expect(ERROR_STATUS_MAP.UPLOAD_TOO_LARGE).toBe(413);
    expect(ERROR_STATUS_MAP.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(ERROR_STATUS_MAP.CHECKSUM_MISMATCH).toBe(422);
    expect(ERROR_STATUS_MAP.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS_MAP.PRECONDITION_FAILED).toBe(412);
    expect(ERROR_STATUS_MAP.PRECONDITION_REQUIRED).toBe(428);
    expect(ERROR_STATUS_MAP.DEPENDENCY_UNAVAILABLE).toBe(503);
  });

  it("carries its mapped status and optional details", () => {
    const error = new AppError("INVALID_STATE_TRANSITION", "bad transition", { from: "a", to: "b" });
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ from: "a", to: "b" });
  });

  it("passes an existing AppError through unchanged via from()", () => {
    const original = new AppError("RATE_LIMITED", "slow down");
    expect(AppError.from(original)).toBe(original);
  });

  it("collapses unknown thrown values to a sanitized internal error", () => {
    const mapped = AppError.from(new Error("leaked stack trace with secret=abc"));
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.status).toBe(500);
    expect(mapped.message).toBe("Internal server error");
  });
});

describe("toErrorEnvelope", () => {
  it("matches the API_SPEC.md §1.2 envelope shape", () => {
    const error = new AppError("INVALID_INPUT", "Payload tidak valid", { field: "slug" });
    const envelope = toErrorEnvelope(error, "req_abc");
    expect(envelope).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Payload tidak valid",
        details: { field: "slug" },
        request_id: "req_abc",
      },
    });
  });

  it("omits `details` when absent and allows a null request id", () => {
    const error = new AppError("AUTH_REQUIRED", "Session required");
    const envelope = toErrorEnvelope(error, null);
    expect(envelope.error).not.toHaveProperty("details");
    expect(envelope.error.request_id).toBeNull();
  });
});
