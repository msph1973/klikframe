import { getAuthRequestHandler } from "@/lib/auth/server";

/**
 * Proxies `/api/auth/*` straight to Managed Better Auth (ARCHITECTURE.md
 * §3.2). The concrete handler is wired via `setAuthRequestHandler` by the
 * provider worktree (Phase 0 Step 3); this file stays stable so that wave
 * never has to edit the composition root.
 */
async function handleAuthRequest(request: Request): Promise<Response> {
  return getAuthRequestHandler()(request);
}

export {
  handleAuthRequest as GET,
  handleAuthRequest as POST,
  handleAuthRequest as PUT,
  handleAuthRequest as PATCH,
  handleAuthRequest as DELETE,
};
