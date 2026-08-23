import { getAuthRequestHandler } from "@/lib/auth/server";
import {
  generateRequestId,
  isValidRequestId,
  REQUEST_ID_HEADER,
  withRequestIdHeader,
  withRequestIdRequestHeader,
} from "@/lib/http/request-id";

/**
 * Proxies `/api/auth/*` straight to Managed Better Auth (ARCHITECTURE.md
 * §3.2). The concrete handler is wired via `setAuthRequestHandler` by the
 * provider worktree (Phase 0 Step 3); this file stays stable so that wave
 * never has to edit the composition root. It also guarantees a single,
 * consistent `X-Request-Id` across the delegated request and response: the
 * delegate receives a request with the header forced to the computed ID
 * (so a well-behaved handler that echoes it aligns naturally), and the
 * response header is always overwritten to that same ID regardless of
 * what the delegate set, so a handler that mints its own ID (like this
 * project's own unconfigured default) can never desync client-observed
 * correlation from provider-side logs.
 */
async function handleAuthRequest(request: Request): Promise<Response> {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : generateRequestId();
  const response = await getAuthRequestHandler()(withRequestIdRequestHeader(request, requestId));
  return withRequestIdHeader(response, requestId);
}

export {
  handleAuthRequest as GET,
  handleAuthRequest as POST,
  handleAuthRequest as PUT,
  handleAuthRequest as PATCH,
  handleAuthRequest as DELETE,
};
