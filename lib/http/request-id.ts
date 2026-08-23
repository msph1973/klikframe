import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * NFR-OBS-001 / DEPLOYMENT.md §5: every response carries `X-Request-Id` so
 * audit, delivery, and provider errors correlate across logs.
 */
export const REQUEST_ID_HEADER = "X-Request-Id";

const REQUEST_ID_PATTERN =
  /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestIdVariables {
  requestId: string;
}

export function generateRequestId(): string {
  return `req_${randomUUID()}`;
}

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

/**
 * Reuses a caller-supplied `X-Request-Id` only when it matches the
 * generated shape, otherwise mints a fresh one. Always echoes the final
 * value back on the response.
 */
export function requestIdMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = isValidRequestId(incoming) ? incoming : generateRequestId();
    c.set("requestId", requestId);
    await next();
    c.header(REQUEST_ID_HEADER, requestId);
  };
}

/**
 * Forces `X-Request-Id` on a raw `Response` built outside Hono's context
 * (e.g. a delegated auth-provider handler), always overwriting any value
 * the delegate set itself. The composition point (not the delegate) is
 * the single source of truth for which ID a given request/response pair
 * correlates under; a delegate that mints its own ID instead of echoing
 * the incoming one must not win.
 *
 * `Set-Cookie` needs special care: auth responses establish sessions, and
 * a Headers instance collapses repeated `set-cookie` entries when built
 * from `headers.entries()` iteration (last-one-wins). `getSetCookie()`
 * exposes every cookie individually; they are re-`append`ed after the
 * rebuild so a multi-cookie session response survives intact.
 */
export function withRequestIdHeader(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  const setCookies = response.headers.getSetCookie();
  headers.delete("set-cookie");
  headers.set(REQUEST_ID_HEADER, requestId);
  const rebuilt = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  for (const cookie of setCookies) {
    rebuilt.headers.append("set-cookie", cookie);
  }
  return rebuilt;
}

/** Clones a `Request` with `X-Request-Id` forced, so a well-behaved delegate that echoes what it received naturally aligns. */
export function withRequestIdRequestHeader(request: Request, requestId: string): Request {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Request(request, { headers });
}
