import type { Env } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/http/errors";

/**
 * Cookie-authenticated state-changing endpoints trust the session cookie on
 * every request they receive, so a foreign site that makes the browser
 * attach it must never be able to drive a mutation (API_SPEC.md §1.6,
 * SECURITY.md §4: "Mutasi cookie-based memverifikasi `Origin`/`Host`").
 * Cross-origin browsers cannot forge an arbitrary Origin header, so an
 * exact match against the deployment's own origin is a sufficient CSRF
 * boundary here; non-browser clients (cron) authenticate by secret instead
 * of cookies and never pass through this guard.
 */

/**
 * Resolves the single trusted origin from canonical env. Returns `null`
 * when `APP_ORIGIN` is unset so composition roots can decide their own
 * failure mode (the production deploy sets it; a missing value in
 * development surfaces as a request-time denial, not a boot crash).
 */
export function trustedOriginFromEnv(env: Pick<Env, "APP_ORIGIN">): string | null {
  const origin = env.APP_ORIGIN;
  if (origin === undefined) return null;
  try {
    return normalizeOrigin(origin);
  } catch {
    // An unparsable configured origin trusts nothing rather than crashing.
    return null;
  }
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  // An origin is scheme + host + port only; a configured URL with a path
  // would never equal a browser-sent Origin, so strip it deterministically.
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Guard for cookie-authenticated mutations: resolves the trusted origin
 * and throws `ORIGIN_DENIED` unless the request carries EXACTLY that
 * Origin (API_SPEC.md §1.6: foreign, absent, or `null` Origin is denied).
 * Call it at the very start of the handler — before session resolution
 * and any database work — so untrusted traffic never triggers
 * authenticated side effects.
 */
export function assertSameOrigin(request: Request, env: Pick<Env, "APP_ORIGIN"> = getEnv()): void {
  const trusted = trustedOriginFromEnv(env);
  if (trusted === null) {
    // Fail closed: without a configured origin no mutation can be proven
    // same-origin, so every request is foreign by definition.
    throw new AppError("ORIGIN_DENIED", "Request origin is not trusted");
  }
  const origin = request.headers.get("Origin");
  if (origin === null || origin.length === 0) {
    // Absent Origin on a state-changing request is foreign by definition
    // (API_SPEC.md §1.6: "absent ... ditolak 403 ORIGIN_DENIED").
    throw new AppError("ORIGIN_DENIED", "Missing Origin header");
  }
  // The sandbox/"null" pseudo-origin (sandboxed iframe, redirected POST):
  // treat every spelling as foreign.
  if (origin.trim().toLowerCase() === "null") {
    throw new AppError("ORIGIN_DENIED", "Missing or null Origin header");
  }
  let normalized: string;
  try {
    normalized = normalizeOrigin(origin);
  } catch {
    throw new AppError("ORIGIN_DENIED", "Malformed Origin header");
  }
  if (normalized !== trusted) {
    throw new AppError("ORIGIN_DENIED", "Request origin is not trusted");
  }
}
