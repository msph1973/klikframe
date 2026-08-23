import { createRemoteJWKSet, jwtVerify } from "jose";
import type {
  FlattenedJWSInput,
  JWK,
  JWTHeaderParameters,
  KeyObject,
} from "jose";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { ProviderError } from "@/lib/shared/provider-error";
import type {
  AuthenticatedIdentity,
  IdentitySessionPort,
  SessionResolution,
} from "./identity-session-port";

/**
 * `IdentitySessionPort` implementation against Neon Auth (Managed Better
 * Auth) — ARCHITECTURE.md §3.2. Neon Auth mints a JWT whose signature the
 * app verifies against the project's JWKS endpoint
 * (`NEON_AUTH_BASE_URL + /.well-known/jwks.json`) using `jose`; claims are
 * Zod-validated before they become an `AuthenticatedIdentity`.
 *
 * Resolution contract (frozen port):
 * - valid token → `{kind: "authenticated"}` with identity + session bounds,
 * - structurally valid but expired token → `{kind: "expired"}`,
 * - absent/unverifiable credential → `{kind: "unauthenticated"}`.
 *
 * Malformed JWKS or malformed token claims map to the frozen `ProviderError`
 * taxonomy with sanitized messages — raw provider payloads never surface.
 *
 * Wired into the composition points via `setIdentitySessionPort` /
 * `wireIdentitySessionPort()` from `lib/providers/composition.ts`.
 */

/** Named contract for the jose JWKS key resolver used by this adapter. */
export type JwksVerifier = (
  protectedHeader: JWTHeaderParameters,
  token: FlattenedJWSInput,
) => Promise<CryptoKey | KeyObject | JWK | Uint8Array>;

const IDENTITY_CLAIM_SCHEMA = z.object({
  sub: z.string().min(1),
  email: z.email().nullable().optional(),
  iat: z.number(),
  exp: z.number(),
});

/** Bearer scheme name for header parsing; case-insensitive per RFC 6750. */
const BEARER_PREFIX = /^bearer\s+/i;

/**
 * Managed Better Auth's canonical session cookie name. Keeping exactly one
 * canonical match means arbitrary cookies are never trusted as identity.
 */
const SESSION_COOKIE_NAME = "better-auth.session_token";

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  return header.replace(BEARER_PREFIX, "").trim() || null;
}

function extractSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(pair.slice(separator + 1).trim()) || null;
    }
  }
  return null;
}

export class NeonAuthAdapter implements IdentitySessionPort {
  private readonly baseUrl: string;
  private readonly jwks: JwksVerifier;

  constructor(options: { readonly jwks?: JwksVerifier } = {}) {
    const env = getEnv();
    const baseUrl = env.NEON_AUTH_BASE_URL;
    if (!baseUrl) {
      throw new ProviderError(
        "permanent",
        { provider: "neon-auth", operation: "configure" },
        "NEON_AUTH_BASE_URL must be configured for the auth adapter",
      );
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.jwks = options.jwks ?? createRemoteJWKSet(new URL(`${this.baseUrl}/.well-known/jwks.json`));
  }

  async resolveSession(request: Request): Promise<SessionResolution> {
    const token = extractBearerToken(request) ?? extractSessionCookie(request);
    if (!token) {
      return { kind: "unauthenticated" };
    }

    let payload: unknown;
    try {
      // `issuer` pins acceptance to the configured Neon Auth project so a
      // token from another project can never authenticate here.
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.baseUrl,
        clockTolerance: 0,
      });
      payload = result.payload;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "JWTExpired") {
        return { kind: "expired" };
      }
      // Signature/claim/structure failures are an expected request state —
      // unauthenticated — not a provider fault.
      void cause;
      return { kind: "unauthenticated" };
    }

    const shaped = IDENTITY_CLAIM_SCHEMA.safeParse(payload);
    if (!shaped.success) {
      throw new ProviderError(
        "malformed_response",
        { provider: "neon-auth", operation: "resolveSession" },
        "The identity provider returned claims that do not satisfy the session schema",
      );
    }
    const identity: AuthenticatedIdentity = {
      authUserId: shaped.data.sub,
      email: shaped.data.email ?? null,
    };
    return {
      kind: "authenticated",
      session: {
        identity,
        issuedAt: new Date(shaped.data.iat * 1000),
        expiresAt: new Date(shaped.data.exp * 1000),
      },
    };
  }
}
