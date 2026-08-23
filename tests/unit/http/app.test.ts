import { describe, expect, it } from "vitest";
import { createApp } from "../../../lib/http/app";
import { REQUEST_ID_HEADER, isValidRequestId } from "../../../lib/http/request-id";

describe("createApp", () => {
  it("serves a sanitized health response with no dependency detail", async () => {
    const app = createApp();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ok", version: expect.any(String) as string });
    expect(isValidRequestId(res.headers.get(REQUEST_ID_HEADER))).toBe(true);
  });

  it("maps unknown routes to a RESOURCE_NOT_FOUND envelope", async () => {
    const app = createApp();
    const res = await app.request("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; request_id: string | null } };
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.request_id).toBe(res.headers.get(REQUEST_ID_HEADER));
  });

  it("maps a thrown error to a sanitized INTERNAL_ERROR envelope", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new Error("leaked internals: DATABASE_URL=postgres://user:pass@host/db");
    });
    const res = await app.request("/api/v1/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; request_id: string | null };
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.request_id).toBe(res.headers.get(REQUEST_ID_HEADER));
    expect(isValidRequestId(res.headers.get(REQUEST_ID_HEADER))).toBe(true);
  });
});
