import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  generateRequestId,
  isValidRequestId,
  REQUEST_ID_HEADER,
  requestIdMiddleware,
  type RequestIdVariables,
} from "../../../lib/http/request-id";

describe("generateRequestId", () => {
  it("produces a req_<uuid> value accepted by isValidRequestId", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(isValidRequestId(id)).toBe(true);
  });

  it("produces unique values across calls", () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe("isValidRequestId", () => {
  it("rejects malformed or missing values", () => {
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId("not-a-request-id")).toBe(false);
    expect(isValidRequestId("req_short")).toBe(false);
  });
});

describe("requestIdMiddleware", () => {
  function buildApp() {
    const app = new Hono<{ Variables: RequestIdVariables }>();
    app.use("*", requestIdMiddleware());
    app.get("/probe", (c) => c.json({ requestId: c.get("requestId") }));
    return app;
  }

  it("mints a request id and echoes it on the response header", async () => {
    const app = buildApp();
    const res = await app.request("/probe");
    const header = res.headers.get(REQUEST_ID_HEADER);
    expect(header).not.toBeNull();
    expect(isValidRequestId(header)).toBe(true);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(header);
  });

  it("reuses a well-formed incoming request id", async () => {
    const app = buildApp();
    const incoming = generateRequestId();
    const res = await app.request("/probe", { headers: { [REQUEST_ID_HEADER]: incoming } });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
  });

  it("replaces a malformed incoming request id", async () => {
    const app = buildApp();
    const res = await app.request("/probe", { headers: { [REQUEST_ID_HEADER]: "attacker-controlled" } });
    const header = res.headers.get(REQUEST_ID_HEADER);
    expect(header).not.toBe("attacker-controlled");
    expect(isValidRequestId(header)).toBe(true);
  });
});
