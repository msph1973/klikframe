import type {
  IdentitySessionPort,
  SessionResolution,
} from "./identity-session-port";

/**
 * Deterministic in-memory `IdentitySessionPort` (TESTING.md §2.2 "auth
 * memakai IdentitySessionPort test adapter"): resolves to whatever
 * resolution was last seeded, unauthenticated by default. Mirrors the fake
 * selection rule of `lib/providers/composition.ts` — wired automatically
 * under `NODE_ENV === "test"` so unit suites never construct the real
 * Neon adapter or touch JWKS/network.
 */
export class FakeIdentitySessionPort implements IdentitySessionPort {
  private resolution: SessionResolution = { kind: "unauthenticated" };

  resolveSession(): Promise<SessionResolution> {
    return Promise.resolve(this.resolution);
  }

  /** Test seam: pins the resolution every subsequent call returns. */
  seed(resolution: SessionResolution): void {
    this.resolution = resolution;
  }
}

let wired: FakeIdentitySessionPort | undefined;

/**
 * Process-wide fake port handed out by `wireIdentitySessionPort()` under
 * test. One shared instance lets suites seed a session and have the wired
 * composition point observe it; `seed()` overwrites state explicitly, so
 * tests reset by seeding `{ kind: "unauthenticated" }`.
 */
export function getFakeIdentitySessionPort(): FakeIdentitySessionPort {
  wired ??= new FakeIdentitySessionPort();
  return wired;
}
