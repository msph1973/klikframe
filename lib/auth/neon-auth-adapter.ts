import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
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
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim()) || null;
      } catch {
        // A malformed percent-escape (e.g. "%") is an attacker-controlled
        // request artifact, not a server fault: treat the credential as
        // absent instead of letting the URIError escape resolveSession.
        return null;
      }
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
    // SECURITY: the JWKS endpoint is the root of token trust. Fetching it
    // over cleartext lets a network attacker substitute their own signing
    // keys and mint accepted tokens, so non-HTTPS auth URLs are rejected
    // before any resolver exists (mirrors the https-only env gates for
    // UPSTASH_REDIS_REST_URL / S3_ENDPOINT in lib/config/env.ts).
    if (!baseUrl.startsWith("https://")) {
      throw new ProviderError(
        "permanent",
        { provider: "neon-auth", operation: "configure" },
        "NEON_AUTH_BASE_URL must use https so JWKS trust material cannot be intercepted",
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
      // Provider faults must never masquerade as a 401 for every valid
      // session — classify them into the frozen taxonomy instead. jose
      // surfaces remote-JWKS fetch failures as a bare TypeError; resolver
      // timeouts use JWKSTimeout. Both are transient: retryable.
      const transientFault =
        cause instanceof TypeError || cause instanceof joseErrors.JWKSTimeout;
      if (transientFault) {
        throw new ProviderError(
          "retryable",
          { provider: "neon-auth", operation: "resolveSession" },
          "The identity provider's signing keys could not be verified",
          { cause },
        );
      }
      // A JWKS the resolver could parse but that is structurally broken —
      // or holds multiple conflicting keys — is the provider answering
      // garbage, not a transient outage. Retrying would 503 every request
      // until someone intervenes; fail as malformed_response instead.
      const malformedJwks =
        cause instanceof joseErrors.JWKSInvalid ||
        cause instanceof joseErrors.JWKInvalid ||
        cause instanceof joseErrors.JWKSMultipleMatchingKeys;
      if (malformedJwks) {
        throw new ProviderError(
          "malformed_response",
          { provider: "neon-auth", operation: "resolveSession" },
          "The identity provider returned malformed signing-key data",
          { cause },
        );
      }
      // JWKSNoMatchingKey is NOT a JWKS outage: the set resolved fine and
      // simply holds no key for the token's `kid` — on an unauthenticated
      // request path the header (and thus the kid) is attacker-controlled,
      // so an unknown kid is forged-token territory. Fail closed to
      // unauthenticated (401 path), never a retryable 503; genuine rotation
      // lag self-heals when the client retries with a fresh token.
      if (cause instanceof joseErrors.JWKSNoMatchingKey) {
        return { kind: "unauthenticated" };
      }
      // Everything else (signature/claim/structure failures) is an
      // expected request state — unauthenticated — not a provider fault.
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
    // `shaped` is a discriminated union, not a boolean; binding the data
    // gives definite assignment so later reads stay narrowed.
    const claims = shaped.data;
    const issuedAt = new Date(claims.iat * 1000);
    const expiresAt = new Date(claims.exp * 1000);
    // NumericDates beyond ±8.64e15 ms overflow Date's valid range (a signed
    // token can carry any number); returning them as session bounds would
    // hand callers Invalid Dates.
    if (
      !Number.isFinite(claims.iat) ||
      !Number.isFinite(claims.exp) ||
      Number.isNaN(issuedAt.getTime()) ||
      Number.isNaN(expiresAt.getTime())
    ) {
      throw new ProviderError(
        "malformed_response",
        { provider: "neon-auth", operation: "resolveSession" },
        "The identity provider returned claims that do not satisfy the session schema",
      );
    }
    const identity: AuthenticatedIdentity = {
      authUserId: claims.sub,
      email: claims.email ?? null,
    };
    return {
      kind: "authenticated",
      session: {
        identity,
        issuedAt,
        expiresAt,
      },
    };
  }
}

/**
 * Process-wide adapter cache. `wireIdentitySessionPort()` runs on every
 * cold-start path (route modules, middleware), so construction must be
 * idempotent: the first call wins and later calls reuse the same instance
 * instead of rebuilding a JWKS resolver per request. Under
 * `NODE_ENV === "test"` no caching happens — each call builds a fresh
 * adapter so suites can inject stub resolvers and env without cross-test
 * bleed (mirrors `getProviders()` in lib/providers/composition.ts).
 */
let cachedAdapter: NeonAuthAdapter | undefined;

/** Returns the shared adapter, constructing it on first use. */
export function getNeonAuthAdapter(): NeonAuthAdapter {
  if (getEnv().NODE_ENV === "test") {
    // Every call builds a fresh adapter so suites can inject stub resolvers
    // and env without cross-test bleed (mirrors the fake-provider selection
    // in lib/providers/composition.ts).
    return new NeonAuthAdapter();
  }
  cachedAdapter ??= new NeonAuthAdapter();
  return cachedAdapter;
}

/** Test-only: drops the cached adapter so the next access rebuilds. */
export function resetNeonAuthAdapterForTests(): void {
  cachedAdapter = undefined;
}

