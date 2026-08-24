import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AppError, toErrorEnvelope } from "@/lib/http/errors";
import { generateRequestId, REQUEST_ID_HEADER } from "@/lib/http/request-id";
import type { IdentitySessionPort, SessionResolution } from "./identity-session-port";

/**
 * Composition point for `app/api/auth/[...path]/route.ts` and `proxy.ts`
 * (ARCHITECTURE.md §3.2). Phase 0 Step 3 (provider worktree) wires the real
 * Managed Better Auth handler/middleware here via the setters below; the
 * route/proxy files themselves stay stable so the provider worktree never
 * touches the Next.js composition root.
 */
export type AuthRequestHandler = (request: Request) => Promise<Response>;
export type AuthProxyHandler = (request: NextRequest) => Promise<NextResponse> | NextResponse;

class UnconfiguredIdentitySessionPort implements IdentitySessionPort {
  resolveSession(): Promise<SessionResolution> {
    return Promise.resolve({ kind: "unauthenticated" });
  }
}

function unconfiguredAuthRequestHandler(): Promise<Response> {
  const requestId = generateRequestId();
  const error = new AppError(
    "DEPENDENCY_UNAVAILABLE",
    "Managed Better Auth adapter is not configured for this environment yet.",
  );
  return Promise.resolve(
    Response.json(toErrorEnvelope(error, requestId), {
      status: error.status,
      headers: { [REQUEST_ID_HEADER]: requestId },
    }),
  );
}

function unconfiguredAuthProxyHandler(): NextResponse {
  return NextResponse.next();
}

let identityPort: IdentitySessionPort = new UnconfiguredIdentitySessionPort();
let authRequestHandler: AuthRequestHandler = unconfiguredAuthRequestHandler;
let authProxyHandler: AuthProxyHandler = unconfiguredAuthProxyHandler;

export function getIdentitySessionPort(): IdentitySessionPort {
  return identityPort;
}

/**
 * True once ANY composition root (or test) installed a non-default port.
 * `wireIdentitySessionPort()` consults this so repeated cold-start calls
 * never overwrite a port that came from elsewhere
 * (cubic PRRT_kwDOT_C_FM6bja3w).
 */
export function isIdentitySessionPortWired(): boolean {
  return !(identityPort instanceof UnconfiguredIdentitySessionPort);
}

export function setIdentitySessionPort(port: IdentitySessionPort): void {
  identityPort = port;
}

export function getAuthRequestHandler(): AuthRequestHandler {
  return authRequestHandler;
}

export function setAuthRequestHandler(handler: AuthRequestHandler): void {
  authRequestHandler = handler;
}

export function getAuthProxyHandler(): AuthProxyHandler {
  return authProxyHandler;
}

export function setAuthProxyHandler(handler: AuthProxyHandler): void {
  authProxyHandler = handler;
}

/** Test-only: restores all three composition points to their unconfigured defaults. */
export function resetAuthCompositionForTests(): void {
  identityPort = new UnconfiguredIdentitySessionPort();
  authRequestHandler = unconfiguredAuthRequestHandler;
  authProxyHandler = unconfiguredAuthProxyHandler;
}
