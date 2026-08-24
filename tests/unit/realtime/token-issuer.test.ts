import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../lib/shared/clock";
import { deriveChannelName, REALTIME_TOKEN_MAX_TTL_MS } from "../../../lib/realtime/realtime-port";

/**
 * Token-issuer conformance fixtures (TESTING.md §2.3 "token capability
 * verifier"). The real `AblyTokenIssuer` requires ABLY_API_KEY via getEnv();
 * these tests pin the shared contract every implementation MUST hold using
 * the deterministic fake as the stand-in provider:
 * - TTL within (0, 15 min] measured by a FixedClock,
 * - subscribeOnly always true,
 * - channel derivation matches the frozen deriveChannelName.
 */
import { FakeRealtimeTokenIssuer } from "../../../lib/providers/realtime/fake-realtime";
import type { RealtimeTokenIssuer } from "../../../lib/realtime/realtime-port";

const BASE = new Date("2026-08-20T10:00:00.000Z");

function makeIssuer(issuer: RealtimeTokenIssuer): RealtimeTokenIssuer {
  return issuer;
}

describe("RealtimeTokenIssuer contract (FixedClock)", () => {
  it("caps capability TTL at REALTIME_TOKEN_MAX_TTL_MS", async () => {
    const issuer = makeIssuer(new FakeRealtimeTokenIssuer(new FixedClock(BASE)));
    const capability = await issuer.issueCapability({ kind: "workspace", workspaceId: "ws_owner" });
    const ttlMs = capability.expiresAt.getTime() - BASE.getTime();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(REALTIME_TOKEN_MAX_TTL_MS);
  });

  it("always returns subscribeOnly: true", async () => {
    const issuer = makeIssuer(new FakeRealtimeTokenIssuer(new FixedClock(BASE)));
    const ownerCapability = await issuer.issueCapability({ kind: "workspace", workspaceId: "ws_1" });
    expect(ownerCapability.subscribeOnly).toBe(true);
    const portalCapability = await issuer.issueCapability({
      kind: "portal",
      portalTokenId: "ptok",
      resourceType: "contract",
      resourceId: "c-42",
    });
    // SECURITY.md §1.2: no publish capability ever reaches the browser.
    expect(portalCapability.subscribeOnly).toBe(true);
  });

  it("derives channels exactly like deriveChannelName", async () => {
    const issuer = makeIssuer(new FakeRealtimeTokenIssuer(new FixedClock(BASE)));
    const workspaceChannel = { kind: "workspace" as const, workspaceId: "ws_ab" };
    const portalChannel = {
      kind: "portal" as const,
      portalTokenId: "tok77",
      resourceType: "album" as const,
      resourceId: "alb3",
    };
    const [ownerCap, portalCap] = await Promise.all([
      issuer.issueCapability(workspaceChannel),
      issuer.issueCapability(portalChannel),
    ]);
    expect(ownerCap.channel).toBe(deriveChannelName(workspaceChannel));
    expect(portalCap.channel).toBe(deriveChannelName(portalChannel));
    // Channel names carry only opaque ids — no PII, no raw tokens.
    expect(ownerCap.channel).toMatch(/^workspace:[A-Za-z0-9_-]+$/);
    expect(portalCap.channel).toMatch(/^portal:[A-Za-z0-9_-]+:[a-z]+:[A-Za-z0-9_-]+$/);
  });
});
