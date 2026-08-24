import type { Clock } from "@/lib/shared/clock";
import { ProviderError } from "@/lib/shared/provider-error";
import {
  assertRealtimeTokenTtl,
  deriveChannelName,
  REALTIME_TOKEN_MAX_TTL_MS,
  type RealtimeChannel,
  type RealtimeEventEnvelope,
  type RealtimePublisher,
  type RealtimeTokenCapability,
  type RealtimeTokenIssuer,
} from "@/lib/realtime/realtime-port";

/**
 * Deterministic fake realtime publisher/token issuer (TESTING.md §2.3
 * "fake publisher/token capability verifier + duplicate/order/gap stream").
 *
 * Determinism: injectable Clock, sequential ids, seeded failure injection.
 * Stream-injection seams exist so subscriber-contract tests can drive
 * duplicate/out-of-order/gap scenarios exactly as TESTING.md §3 requires:
 * subscribers must treat duplicates and reordering as idempotent
 * invalidation and recover gaps via refetch — never as state.
 */
export interface InjectedStreamEvent {
  readonly envelope: RealtimeEventEnvelope;
  readonly channelName: string;
}

export class FakeRealtimePublisher implements RealtimePublisher {
  private readonly published: { readonly envelope: RealtimeEventEnvelope; readonly channelNames: readonly string[] }[] = [];
  private failNextPublishes = 0;

  constructor(private readonly clock: Clock) {}

  async publish(envelope: RealtimeEventEnvelope, channels: readonly RealtimeChannel[]): Promise<void> {
    await Promise.resolve();
    if (this.failNextPublishes > 0) {
      this.failNextPublishes -= 1;
      // Mirrors AblyRestPublisher's sanitized retryable fault so callers
      // can exercise `ProviderError.isRetryable` against the real contract;
      // the caller's job is catch/log AFTER commit — never rollback.
      throw new ProviderError(
        "retryable",
        { provider: "ably", operation: "publish" },
        "The realtime provider rejected the publish",
      );
    }
    this.published.push({
      envelope,
      channelNames: channels.map((channel) => deriveChannelName(channel)),
    });
  }

  /** Makes the next `count` publishes throw (provider-outage fixtures). */
  failNext(count: number): void {
    this.failNextPublishes = count;
  }

  get messages(): readonly { readonly envelope: RealtimeEventEnvelope; readonly channelNames: readonly string[] }[] {
    return this.published;
  }

  /**
   * Emits a duplicate stream: each message appears twice in order — the
   * subscriber-side dedupe by `eventId` must make this invisible.
   */
  duplicatedStream(events: readonly InjectedStreamEvent[]): readonly InjectedStreamEvent[] {
    return events.flatMap((event) => [event, event]);
  }

  /** Reorders events by rotating the array by one position. */
  outOfOrderStream(events: readonly InjectedStreamEvent[]): readonly InjectedStreamEvent[] {
    if (events.length < 2) return [...events];
    return [...events.slice(1), ...events.slice(0, 1)];
  }

  /** Drops the event at `gapIndex`, simulating a reconnect gap. */
  gappedStream(events: readonly InjectedStreamEvent[], gapIndex: number): readonly InjectedStreamEvent[] {
    return events.filter((_, index) => index !== gapIndex);
  }
}

interface PendingFailure {
  kind: "retryable" | "permanent" | "timeout";
  remaining: number;
}

export class FakeRealtimeTokenIssuer implements RealtimeTokenIssuer {
  private ttlMs = REALTIME_TOKEN_MAX_TTL_MS;
  private readonly failures: PendingFailure[] = [];

  constructor(private readonly clock: Clock) {}

  async issueCapability(channel: RealtimeChannel): Promise<RealtimeTokenCapability> {
    await Promise.resolve();
    const failure = this.failures[0];
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      if (failure.remaining === 0) this.failures.shift();
      // Sanitized ProviderError with the injected kind so token retry
      // behavior is tested against the real provider contract.
      throw new ProviderError(
        failure.kind,
        { provider: "ably", operation: "token" },
        "The realtime provider rejected the token request",
      );
    }
    const expiresAt = new Date(this.clock.now().getTime() + this.ttlMs);
    // Mandatory guard before returning any capability (frozen port rule).
    assertRealtimeTokenTtl(this.clock, expiresAt);
    return {
      channel: deriveChannelName(channel),
      expiresAt,
      subscribeOnly: true,
    };
  }

  /** Overrides the issued TTL for expiry/negative tests. */
  withTtl(ms: number): this {
    this.ttlMs = ms;
    return this;
  }

  /**
   * Makes the next `count` issuances fail with the given kind. Non-positive
   * counts are ignored: a zero-length entry would otherwise sit at the
   * queue head forever and starve every later injection behind it.
   */
  failNext(count: number, kind: "retryable" | "permanent" | "timeout"): void {
    if (!Number.isInteger(count) || count < 1) return;
    this.failures.push({ kind, remaining: count });
  }
}
