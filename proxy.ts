import type { NextRequest } from "next/server";
import { getAuthProxyHandler } from "@/lib/auth/server";

/**
 * Next.js 16 proxy (formerly `middleware.ts`). Delegates to
 * `auth.middleware()` once the provider worktree wires it via
 * `setAuthProxyHandler` (ARCHITECTURE.md §3.2); until then this passes
 * every request through unchanged.
 */
export async function proxy(request: NextRequest) {
  return getAuthProxyHandler()(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
