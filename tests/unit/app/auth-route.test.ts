import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../../../app/api/auth/[...path]/route";
import { REQUEST_ID_HEADER } from "../../../lib/http/request-id";
import { getAuthRequestHandler, setAuthRequestHandler } from "../../../lib/auth/server";

describe("app/api/auth/[...path] route", () => {
  const defaultHandler = getAuthRequestHandler();

  afterEach(() => {
    setAuthRequestHandler(defaultHandler);
  });

  it("adds X-Request-Id when the delegated handler forgets it", async () => {
    setAuthRequestHandler(() => Promise.resolve(new Response("ok", { status: 200 })));
    const response = await GET(new Request("https://example.com/api/auth/get-session"));
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("does not override a request id the delegated handler already set", async () => {
    setAuthRequestHandler(() =>
      Promise.resolve(new Response("ok", { headers: { [REQUEST_ID_HEADER]: "req_from-provider" } })),
    );
    const response = await GET(new Request("https://example.com/api/auth/get-session"));
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("req_from-provider");
  });

  it("reuses a well-formed incoming request id on the outgoing response", async () => {
    setAuthRequestHandler(() => Promise.resolve(new Response("ok")));
    const incoming = "req_11111111-1111-4111-8111-111111111111";
    const response = await GET(
      new Request("https://example.com/api/auth/get-session", {
        headers: { [REQUEST_ID_HEADER]: incoming },
      }),
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
  });
});
