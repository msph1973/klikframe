/**
 * Frozen, vendor-neutral identity/session contract (ARCHITECTURE.md §3.2,
 * SECURITY.md §1). The Managed Better Auth adapter (Phase 0 Step 3,
 * `lib/auth/neon-auth-adapter.ts`) implements this port; no caller may
 * depend on Neon/Better Auth types directly.
 */
export interface AuthenticatedIdentity {
  readonly authUserId: string;
  readonly email: string | null;
}

export interface OwnerSession {
  readonly identity: AuthenticatedIdentity;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export type SessionResolution =
  | { readonly kind: "authenticated"; readonly session: OwnerSession }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "expired" };

export interface IdentitySessionPort {
  resolveSession(request: Request): Promise<SessionResolution>;
}
