import type { Clock } from "@/lib/shared/clock";

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

interface RealtimeEventEnvelopeBase {
  readonly eventId: string;
  readonly schemaVersion: 1;
  readonly occurredAt: string; // RFC 3339
}

/**
 * Encodes API_SPEC.md §9.6's fixed event-to-resource mapping as a
 * discriminated union so a mismatched pair (e.g. `contract.signed` against
 * an `album` resource) cannot type-check.
 */
export type RealtimeEventEnvelope =
  | (RealtimeEventEnvelopeBase & {
      readonly eventType: "contract.signed";
      readonly resource: { readonly type: "contract"; readonly id: string };
    })
  | (RealtimeEventEnvelopeBase & {
      readonly eventType: "invoice.updated" | "payment.recorded";
      readonly resource: { readonly type: "invoice"; readonly id: string };
    })
  | (RealtimeEventEnvelopeBase & {
      readonly eventType: "gallery.published" | "selection.updated";
      readonly resource: { readonly type: "album"; readonly id: string };
    });

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

export interface RealtimePublisher {
  /**
   * Publishes to every given channel (e.g. the owner's workspace channel
   * plus any active portal session scoped to the same resource). The
   * caller resolves and authorizes `channels`; the publisher trusts them.
   */
  publish(envelope: RealtimeEventEnvelope, channels: readonly RealtimeChannel[]): Promise<void>;
}

export interface RealtimeTokenCapability {
  readonly channel: string;
  readonly expiresAt: Date;
  readonly subscribeOnly: true;
}

export interface RealtimeTokenIssuer {
  /** Implementations MUST call `assertRealtimeTokenTtl` before returning. */
  issueCapability(channel: RealtimeChannel): Promise<RealtimeTokenCapability>;
}

/**
 * Runtime guard for the type-level TTL cap: a `RealtimeTokenCapability`'s
 * `expiresAt` is just a `Date` field, so nothing stops an issuer from
 * returning a long-lived one. Every `RealtimeTokenIssuer` implementation
 * MUST call this before returning a capability.
 */
export function assertRealtimeTokenTtl(clock: Clock, expiresAt: Date): void {
  const ttlMs = expiresAt.getTime() - clock.now().getTime();
  if (ttlMs <= 0 || ttlMs > REALTIME_TOKEN_MAX_TTL_MS) {
    throw new RangeError(
      `Realtime token capability expiresAt must be within (0, ${String(REALTIME_TOKEN_MAX_TTL_MS)}] ms of now (got ${String(ttlMs)}ms)`,
    );
  }
}
