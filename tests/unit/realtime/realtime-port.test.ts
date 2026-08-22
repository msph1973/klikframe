import { describe, expect, it } from "vitest";
import {
  deriveChannelName,
  REALTIME_EVENT_TYPES,
  REALTIME_TOKEN_MAX_TTL_MS,
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

describe("REALTIME_TOKEN_MAX_TTL_MS", () => {
  it("never exceeds the SECURITY.md §1.2 15-minute cap", () => {
    expect(REALTIME_TOKEN_MAX_TTL_MS).toBe(15 * 60 * 1000);
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
