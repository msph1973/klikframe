import { getAuthRequestHandler } from "@/lib/auth/server";
import {
  ensureRequestIdHeader,
  generateRequestId,
  isValidRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/http/request-id";

/**
 * Proxies `/api/auth/*` straight to Managed Better Auth (ARCHITECTURE.md
 * §3.2). The concrete handler is wired via `setAuthRequestHandler` by the
 * provider worktree (Phase 0 Step 3); this file stays stable so that wave
 * never has to edit the composition root. It also guarantees
 * `X-Request-Id` on every response regardless of what the delegated
 * handler does, since a real Better Auth handler has no reason to know
 * about this project's header convention.
 */
async function handleAuthRequest(request: Request): Promise<Response> {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : generateRequestId();
  const response = await getAuthRequestHandler()(request);
  return ensureRequestIdHeader(response, requestId);
}

export {
  handleAuthRequest as GET,
  handleAuthRequest as POST,
  handleAuthRequest as PUT,
  handleAuthRequest as PATCH,
  handleAuthRequest as DELETE,
};
