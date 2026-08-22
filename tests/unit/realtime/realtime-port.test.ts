import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../lib/shared/clock";
import {
  assertRealtimeTokenTtl,
  deriveChannelName,
  REALTIME_EVENT_TYPES,
  REALTIME_TOKEN_MAX_TTL_MS,
  type RealtimeEventEnvelope,
} from "../../../lib/realtime/realtime-port";

describe("REALTIME_EVENT_TYPES", () => {
  it("matches the exact API_SPEC.md §9.6 event set", () => {
    expect(REALTIME_EVENT_TYPES).toEqual([
      "contract.signed",
      "invoice.updated",
      "payment.recorded",
      "gallery.published",
      "selection.updated",
    ]);
  });
});

describe("RealtimeEventEnvelope", () => {
  it("accepts every event type paired with its API_SPEC.md §9.6 resource type", () => {
    const envelopes: RealtimeEventEnvelope[] = [
      {
        eventId: "evt_1",
        schemaVersion: 1,
        occurredAt: "2026-08-20T10:00:00Z",
        eventType: "contract.signed",
        resource: { type: "contract", id: "c_1" },
      },
      {
        eventId: "evt_2",
        schemaVersion: 1,
        occurredAt: "2026-08-20T10:00:00Z",
        eventType: "payment.recorded",
        resource: { type: "invoice", id: "i_1" },
      },
      {
        eventId: "evt_3",
        schemaVersion: 1,
        occurredAt: "2026-08-20T10:00:00Z",
        eventType: "selection.updated",
        resource: { type: "album", id: "a_1" },
      },
    ];
    expect(envelopes).toHaveLength(3);
  });
});

describe("deriveChannelName", () => {
  it("derives an owner workspace channel", () => {
    expect(deriveChannelName({ kind: "workspace", workspaceId: "ws_1" })).toBe("workspace:ws_1");
  });

  it("derives a scoped portal channel from typed resource target", () => {
    expect(
      deriveChannelName({
        kind: "portal",
        portalTokenId: "tok_1",
        resourceType: "invoice",
        resourceId: "inv_1",
      }),
    ).toBe("portal:tok_1:invoice:inv_1");
  });
});

describe("assertRealtimeTokenTtl", () => {
  it("accepts an expiry within the 15-minute cap", () => {
    const clock = new FixedClock(new Date("2026-08-20T10:00:00Z"));
    const expiresAt = new Date("2026-08-20T10:10:00Z");
    expect(() => {
      assertRealtimeTokenTtl(clock, expiresAt);
    }).not.toThrow();
  });

  it("rejects an expiry beyond the 15-minute cap", () => {
    const clock = new FixedClock(new Date("2026-08-20T10:00:00Z"));
    const tooFar = new Date(clock.now().getTime() + REALTIME_TOKEN_MAX_TTL_MS + 1);
    expect(() => {
      assertRealtimeTokenTtl(clock, tooFar);
    }).toThrow(RangeError);
  });

  it("rejects an expiry that has already passed", () => {
    const clock = new FixedClock(new Date("2026-08-20T10:00:00Z"));
    const past = new Date(clock.now().getTime() - 1);
    expect(() => {
      assertRealtimeTokenTtl(clock, past);
    }).toThrow(RangeError);
  });
});
