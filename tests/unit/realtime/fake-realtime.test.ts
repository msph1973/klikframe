import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../lib/shared/clock";
import { SequentialUuidGenerator } from "../../../lib/shared/id";
import {
  FakeRealtimePublisher,
  FakeRealtimeTokenIssuer,
} from "../../../lib/providers/realtime/fake-realtime";
import {
  deriveChannelName,
  REALTIME_TOKEN_MAX_TTL_MS,
  type RealtimeEventEnvelope,
} from "../../../lib/realtime/realtime-port";

const BASE = new Date("2026-08-20T10:00:00.000Z");
const uuids = new SequentialUuidGenerator("evt");

function envelope(eventType: RealtimeEventEnvelope["eventType"]): RealtimeEventEnvelope {
  const id = uuids.next();
  switch (eventType) {
    case "contract.signed":
      return { eventId: id, schemaVersion: 1, eventType, resource: { type: "contract", id: "c1" }, occurredAt: BASE.toISOString() };
    case "invoice.updated":
    case "payment.recorded":
      return { eventId: id, schemaVersion: 1, eventType, resource: { type: "invoice", id: "i1" }, occurredAt: BASE.toISOString() };
    default:
      return { eventId: id, schemaVersion: 1, eventType, resource: { type: "album", id: "a1" }, occurredAt: BASE.toISOString() };
  }
}

interface TestStream {
  readonly events: StreamEvent[];
  readonly channels: readonly { readonly kind: "workspace"; readonly workspaceId: string }[];
}

interface StreamEvent {
  readonly envelope: RealtimeEventEnvelope;
  readonly channelName: string;
}

function stream(): TestStream {
  const events = [
    { envelope: envelope("invoice.updated"), channelName: "workspace:ws_1" },
    { envelope: envelope("payment.recorded"), channelName: "workspace:ws_1" },
    { envelope: envelope("gallery.published"), channelName: "workspace:ws_1" },
  ];
  const channels = [{ kind: "workspace" as const, workspaceId: "ws_1" }];
  return { events, channels };
}

describe("FakeRealtimePublisher — subscriber contract streams", () => {
  it("records publishes with derived channel names", async () => {
    const publisher = new FakeRealtimePublisher(new FixedClock(BASE));
    const { events, channels } = stream();
    await publisher.publish(events[0]?.envelope ?? envelope("invoice.updated"), channels);
    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]?.channelNames).toEqual(["workspace:ws_1"]);
  });

  it("duplicate injection repeats every event — subscribers dedupe by eventId", async () => {
    await Promise.resolve();
    const publisher = new FakeRealtimePublisher(new FixedClock(BASE));
    const { events } = stream();
    const duplicated = publisher.duplicatedStream(events);
    expect(duplicated).toHaveLength(6);
    // Subscriber contract (API_SPEC.md §9.6): dedupe by event_id makes the
    // duplicate stream equivalent to the original.
    const uniqueIds = new Set(duplicated.map((event) => event.envelope.eventId));
    expect(uniqueIds.size).toBe(3);
  });

  it("out-of-order injection reorders events — invalidation stays idempotent", async () => {
    await Promise.resolve();
    const publisher = new FakeRealtimePublisher(new FixedClock(BASE));
    const { events } = stream();
    const reordered = publisher.outOfOrderStream(events);
    expect(reordered.map((event) => event.envelope.eventId)).not.toEqual(
      events.map((event) => event.envelope.eventId),
    );
    // The same set of events arrives regardless of order.
    expect([...new Set(reordered.map((event) => event.envelope.eventId))].sort()).toEqual(
      [...new Set(events.map((event) => event.envelope.eventId))].sort(),
    );
  });
  it("gap injection drops an event — recovery is refetch, not state application", async () => {
    await Promise.resolve();
    const publisher = new FakeRealtimePublisher(new FixedClock(BASE));
    const { events } = stream();
    const gapped = publisher.gappedStream(events, 1);
    expect(gapped).toHaveLength(2);
    expect(gapped.map((event) => event.envelope.eventId)).not.toContain(
      (events[1] ?? gapped[0])?.envelope.eventId,
    );
  });

  it("failNext throws sanitized provider-style failures for outage fixtures", async () => {
    const publisher = new FakeRealtimePublisher(new FixedClock(BASE));
    publisher.failNext(1);
    await expect(
      publisher.publish(envelope("invoice.updated"), [{ kind: "workspace", workspaceId: "ws_1" }]),
    ).rejects.toThrow("fake publish failure");
    // Not recorded; next publish succeeds.
    await publisher.publish(envelope("invoice.updated"), [{ kind: "workspace", workspaceId: "ws_1" }]);
    expect(publisher.messages).toHaveLength(1);
  });
});

describe("FakeRealtimeTokenIssuer — capability contract", () => {
  it("issues subscribe-only capabilities at exactly the 15-minute cap", async () => {
    const issuer = new FakeRealtimeTokenIssuer(new FixedClock(BASE));
    const capability = await issuer.issueCapability({ kind: "workspace", workspaceId: "ws_1" });
    expect(capability.subscribeOnly).toBe(true);
    expect(capability.channel).toBe(deriveChannelName({ kind: "workspace", workspaceId: "ws_1" }));
    expect(capability.expiresAt.getTime() - BASE.getTime()).toBe(REALTIME_TOKEN_MAX_TTL_MS);
  });

  it("derives portal channels exactly like deriveChannelName", async () => {
    const issuer = new FakeRealtimeTokenIssuer(new FixedClock(BASE));
    const capability = await issuer.issueCapability({
      kind: "portal",
      portalTokenId: "tok_1",
      resourceType: "invoice",
      resourceId: "inv-9",
    });
    expect(capability.channel).toBe("portal:tok_1:invoice:inv-9");
  });

  it("rejects TTL overrides beyond the frozen cap via assertRealtimeTokenTtl", async () => {
    const issuer = new FakeRealtimeTokenIssuer(new FixedClock(BASE)).withTtl(REALTIME_TOKEN_MAX_TTL_MS + 1);
    await expect(
      issuer.issueCapability({ kind: "workspace", workspaceId: "ws_1" }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("supports failure injection for token-outage fixtures", async () => {
    const issuer = new FakeRealtimeTokenIssuer(new FixedClock(BASE));
    issuer.failNext(1, "timeout");
    await expect(issuer.issueCapability({ kind: "workspace", workspaceId: "ws_1" })).rejects.toThrow(
      "fake token failure: timeout",
    );
    const recovered = await issuer.issueCapability({ kind: "workspace", workspaceId: "ws_1" });
    expect(recovered.subscribeOnly).toBe(true);
  });
});
