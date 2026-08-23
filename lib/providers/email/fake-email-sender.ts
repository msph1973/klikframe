import { createHash } from "node:crypto";
import type { Clock } from "@/lib/shared/clock";
import { ProviderError } from "@/lib/shared/provider-error";
import type {
  EmailDeliveryRecord,
  EmailSender,
  SendEmailRequest,
} from "./email-port";

/**
 * Deterministic capture `EmailSender` (TESTING.md §2.3 "capture adapter
 * with deterministic failures"). Records every delivery for assertions and
 * injects failures WITHOUT randomness:
 * - `failNext(n, kind)` / `timeoutNext(n)` make the next n sends fail in
 *   FIFO order regardless of concurrency,
 * - success message ids derive deterministically from the dedupe key.
 */
/** Failure modes mirroring TESTING.md §2.3 provider failure fixtures. */
export type InjectedFailureKind = "retryable" | "permanent" | "malformed_response" | "timeout";

export class FakeEmailSender implements EmailSender {
  private readonly captured: EmailDeliveryRecord[] = [];
  private failureQueue: InjectedFailureKind[] = [];

  constructor(private readonly clock: Clock) {}

  async send(request: SendEmailRequest): Promise<EmailDeliveryRecord> {
    // Deterministic timeout: a retryable-kind ProviderError carrying the
    // operation context, exactly like the real adapter's timeout path.
    await Promise.resolve();
    const injected = this.failureQueue.shift();
    if (injected !== undefined) {
      if (injected === "timeout") {
        throw new ProviderError(
          "timeout",
          { provider: "resend", operation: "send" },
          "The email provider did not respond before the configured deadline",
        );
      }
      throw new ProviderError(
        injected,
        { provider: "resend", operation: "send" },
        `The email provider reported an ${injected} failure`,
      );
    }

    const record: EmailDeliveryRecord = {
      // Deterministic id: same dedupeKey always yields the same messageId,
      // so tests can assert replay/dedupe behavior without randomness.
      messageId: `fake-${createHash("sha256").update(request.dedupeKey).digest("hex").slice(0, 24)}`,
      to: request.to,
      subject: request.subject,
      kind: request.kind,
      dedupeKey: request.dedupeKey,
      sentAt: this.clock.now(),
    };
    this.captured.push(record);
    return record;
  }

  /** Makes the next `count` sends fail with the given error kind. */
  failNext(count: number, kind: Exclude<InjectedFailureKind, "timeout">): void {
    this.failureQueue.push(...(Array<InjectedFailureKind>(count).fill(kind)));
  }

  /** Makes the next `count` sends time out. */
  timeoutNext(count: number): void {
    this.failureQueue.push(...(Array<InjectedFailureKind>(count).fill("timeout")));
  }

  /** All successful deliveries, oldest first. */
  get deliveries(): readonly EmailDeliveryRecord[] {
    return this.captured;
  }

  /** Delivery whose dedupe key matches, or undefined. */
  findByDedupeKey(dedupeKey: string): EmailDeliveryRecord | undefined {
    return this.captured.find((record) => record.dedupeKey === dedupeKey);
  }

  /** True when no send failed after the last injection reset. */
  get hasPendingFailures(): boolean {
    return this.failureQueue.length > 0;
  }

  /** Clears queued injections (between tests). */
  reset(): void {
    this.failureQueue = [];
  }
}
