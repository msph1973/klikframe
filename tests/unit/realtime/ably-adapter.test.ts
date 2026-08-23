import { describe, expect, it, vi } from "vitest";
import { FixedClock } from "../../../lib/shared/clock";
import { resetEnvCacheForTests } from "../../../lib/config/env";
import { AblyRestPublisher, AblyTokenIssuer } from "../../../lib/providers/realtime/ably-adapter";
import { REALTIME_TOKEN_MAX_TTL_MS } from "../../../lib/realtime/realtime-port";

const BASE = new Date("2026-08-20T10:00:00.000Z");

function envAbly(): void {
  process.env.ABLY_API_KEY = "appId.keyId:test-secret-value";
  resetEnvCacheForTests();
}

describe("AblyRestPublisher contract (injected fetch)", () => {
  it("fails construction when ABLY_API_KEY is missing", () => {
    delete process.env.ABLY_API_KEY;
    resetEnvCacheForTests();
    expect(() => new AblyRestPublisher({ clock: new FixedClock(BASE) })).toThrow(/ABLY_API_KEY/);
    envAbly();
  });

  it("publishes the allowlist envelope to every channel and never leaks the secret", async () => {
    envAbly();
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      await Promise.resolve();
      bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE), fetchImpl });
    await publisher.publish(
      {
        eventId: "evt_1",
        schemaVersion: 1,
        eventType: "payment.recorded",
        resource: { type: "invoice", id: "inv-7" },
        occurredAt: BASE.toISOString(),
      },
      [
        { kind: "workspace", workspaceId: "ws_1" },
        { kind: "portal", portalTokenId: "tok", resourceType: "invoice", resourceId: "inv-7" },
      ],
    );
    const body = bodies[0] as { channel: string; data: Record<string, unknown> }[];
    expect(body).toHaveLength(2);
    expect(body[0]?.channel).toBe("workspace:ws_1");
    expect(body[1]?.channel).toBe("portal:tok:invoice:inv-7");
    // Allowlist-only payload (API_SPEC.md §9.6): exactly five fields.
    expect(Object.keys(body[0]?.data ?? {}).sort()).toEqual([
      "event_id",
      "event_type",
      "occurred_at",
      "resource",
      "schema_version",
    ]);
    // The Basic auth header carries the key but nothing in the body does.
    expect(JSON.stringify(bodies)).not.toContain("test-secret-value");
  });

  it("rejects publishes without channels as permanent provider errors", async () => {
    envAbly();
    const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE) });
    await expect(
      publisher.publish(
        {
          eventId: "e",
          schemaVersion: 1,
          eventType: "invoice.updated",
          resource: { type: "invoice", id: "i" },
          occurredAt: BASE.toISOString(),
        },
        [],
      ),
    ).rejects.toMatchObject({ kind: "permanent", provider: "ably" });
  });

  it("maps HTTP 500+ to retryable faults for post-commit callers", async () => {
    envAbly();
    const fetchImpl = (async () => {
      await Promise.resolve();
      return new Response("upstream down", { status: 503 });
    }) as typeof fetch;
    const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE), fetchImpl });
    await expect(
      publisher.publish(
        {
          eventId: "e",
          schemaVersion: 1,
          eventType: "gallery.published",
          resource: { type: "album", id: "a" },
          occurredAt: BASE.toISOString(),
        },
        [{ kind: "workspace", workspaceId: "ws_2" }],
      ),
    ).rejects.toMatchObject({ kind: "retryable", isRetryable: true });
  });

  it("maps HTTP 429 rate limiting to a retryable fault, not permanent", async () => {
    envAbly();
    const fetchImpl = (async () => {
      await Promise.resolve();
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;
    const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE), fetchImpl });
    await expect(
      publisher.publish(
        {
          eventId: "e",
          schemaVersion: 1,
          eventType: "gallery.published",
          resource: { type: "album", id: "a" },
          occurredAt: BASE.toISOString(),
        },
        [{ kind: "workspace", workspaceId: "ws_2" }],
      ),
    ).rejects.toMatchObject({ kind: "retryable", isRetryable: true });
  });

  it("aborts a stalled publish and maps it to timeout", async () => {
    envAbly();
    // The adapter races the fetch against its own deadline; a fetch that
    // never resolves loses the race and surfaces the timeout mapping. Use
    // vitest fake timers so the 10s PUBLISH_TIMEOUT_MS elapses instantly.
    vi.useFakeTimers();
    try {
      const fetchImpl = (async () => {
        await Promise.resolve();
        return new Promise<Response>(() => undefined); // never settles
      }) as typeof fetch;
      const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE), fetchImpl });
      const assertion = expect(
        publisher.publish(
          {
            eventId: "e",
            schemaVersion: 1,
            eventType: "gallery.published",
            resource: { type: "album", id: "a" },
            occurredAt: BASE.toISOString(),
          },
          [{ kind: "workspace", workspaceId: "ws_3" }],
        ),
      ).rejects.toMatchObject({ kind: "timeout", isRetryable: true });
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps an abort-signal rejection from fetch to timeout", async () => {
    envAbly();
    // A well-behaved fetch honors the adapter's AbortController signal:
    // when the deadline aborts, fetch rejects with an abort error, which
    // must map to a timeout-kind ProviderError (retryable).
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
        await Promise.resolve();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("This operation was aborted"));
          });
        });
      }) as typeof fetch;
      const publisher = new AblyRestPublisher({ clock: new FixedClock(BASE), fetchImpl });
      const assertion = expect(
        publisher.publish(
          {
            eventId: "e",
            schemaVersion: 1,
            eventType: "gallery.published",
            resource: { type: "album", id: "a" },
            occurredAt: BASE.toISOString(),
          },
          [{ kind: "workspace", workspaceId: "ws_3b" }],
        ),
      ).rejects.toMatchObject({ kind: "timeout", isRetryable: true });
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("AblyTokenIssuer contract", () => {
  it("issues subscribe-only token requests at the 15-minute cap", async () => {
    envAbly();
    const issuer = new AblyTokenIssuer({ clock: new FixedClock(BASE) });
    const capability = await issuer.issueCapability({ kind: "workspace", workspaceId: "ws_9" });
    expect(capability.subscribeOnly).toBe(true);
    expect(capability.channel).toBe("workspace:ws_9");
    expect(capability.expiresAt.getTime() - BASE.getTime()).toBeLessThanOrEqual(REALTIME_TOKEN_MAX_TTL_MS);
    expect(capability.tokenRequest.keyName).toBe("appId.keyId");
    expect(capability.tokenRequest.mac.length).toBeGreaterThan(0);
    // The signing secret never appears in the returned capability.
    expect(JSON.stringify(capability)).not.toContain("test-secret-value");
  });

  it("signs subscribe-only capability for exactly the requested channel", async () => {
    envAbly();
    const issuer = new AblyTokenIssuer({ clock: new FixedClock(BASE) });
    const capability = await issuer.issueCapability({
      kind: "portal",
      portalTokenId: "ptok",
      resourceType: "contract",
      resourceId: "c-3",
    });
    expect(capability.channel).toBe("portal:ptok:contract:c-3");
    expect(capability.expiresAt.getTime()).toBe(BASE.getTime() + 15 * 60 * 1000);
  });
});
