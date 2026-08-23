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

  it("overwrites a request id the delegated handler minted on its own, so the client-observed and provider-side IDs never desync", async () => {
    setAuthRequestHandler(() =>
      Promise.resolve(new Response("ok", { headers: { [REQUEST_ID_HEADER]: "req_from-provider" } })),
    );
    const incoming = "req_11111111-1111-4111-8111-111111111111";
    const response = await GET(
      new Request("https://example.com/api/auth/get-session", {
        headers: { [REQUEST_ID_HEADER]: incoming },
      }),
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
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

  it("forwards the computed request id to the delegated handler on the request itself", async () => {
    let observed: string | null = null;
    setAuthRequestHandler((request) => {
      observed = request.headers.get(REQUEST_ID_HEADER);
      return Promise.resolve(new Response("ok"));
    });
    const incoming = "req_11111111-1111-4111-8111-111111111111";
    await GET(
      new Request("https://example.com/api/auth/get-session", {
        headers: { [REQUEST_ID_HEADER]: incoming },
      }),
    );
    expect(observed).toBe(incoming);
  });

  it("preserves every Set-Cookie from a session-establishing auth response through the request-id rewrite", async () => {
    setAuthRequestHandler(() => {
      const response = new Response("ok");
      response.headers.append("set-cookie", "better-auth.session_token=abc; Path=/; HttpOnly");
      response.headers.append("set-cookie", "better-auth.session_data=def; Path=/; HttpOnly");
      return Promise.resolve(response);
    });
    const incoming = "req_11111111-1111-4111-8111-111111111111";
    const response = await GET(
      new Request("https://example.com/api/auth/get-session", {
        headers: { [REQUEST_ID_HEADER]: incoming },
      }),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=abc; Path=/; HttpOnly",
      "better-auth.session_data=def; Path=/; HttpOnly",
    ]);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
  });
});
