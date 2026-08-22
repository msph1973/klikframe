/**
 * Frozen realtime contract (ARCHITECTURE.md §3.6, SECURITY.md §1.2,
 * API_SPEC.md §9.6). Vendor-neutral: the provider worktree (Phase 0 Step 3)
 * implements `RealtimePublisher`/`RealtimeTokenIssuer` against Ably without
 * leaking Ably types into callers.
 */
export const REALTIME_EVENT_TYPES = [
  "contract.signed",
  "invoice.updated",
  "payment.recorded",
  "gallery.published",
  "selection.updated",
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export type RealtimeResourceType = "contract" | "invoice" | "album";

export interface RealtimeEventEnvelope {
  readonly eventId: string;
  readonly schemaVersion: 1;
  readonly eventType: RealtimeEventType;
  readonly resource: { readonly type: RealtimeResourceType; readonly id: string };
  readonly occurredAt: string; // RFC 3339
}

export interface RealtimePublisher {
  publish(envelope: RealtimeEventEnvelope): Promise<void>;
}

/** SECURITY.md §1.2: owner/portal capability expiry never exceeds 15 minutes. */
export const REALTIME_TOKEN_MAX_TTL_MS = 15 * 60 * 1000;

export type RealtimeChannel =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | {
      readonly kind: "portal";
      readonly portalTokenId: string;
      readonly resourceType: RealtimeResourceType;
      readonly resourceId: string;
    };

export function deriveChannelName(channel: RealtimeChannel): string {
  if (channel.kind === "workspace") {
    return `workspace:${channel.workspaceId}`;
  }
  return `portal:${channel.portalTokenId}:${channel.resourceType}:${channel.resourceId}`;
}

export interface RealtimeTokenCapability {
  readonly channel: string;
  readonly expiresAt: Date;
  readonly subscribeOnly: true;
}

export interface RealtimeTokenIssuer {
  issueCapability(channel: RealtimeChannel): Promise<RealtimeTokenCapability>;
}
