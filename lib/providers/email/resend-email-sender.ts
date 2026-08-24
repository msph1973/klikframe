import { z } from "zod";
import type { Clock } from "@/lib/shared/clock";
import { getEnv } from "@/lib/config/env";
import { ProviderError, type ProviderErrorKind } from "@/lib/shared/provider-error";
import type {
  EmailDeliveryRecord,
  EmailSender,
  SendEmailRequest,
} from "./email-port";

/**
 * Real `EmailSender` backed by the Resend REST API (ARCHITECTURE.md §3.7:
 * direct send from Route Handlers/Server Actions — no worker in MVP).
 *
 * Raw provider responses enter as `unknown`, are Zod-validated into typed
 * results, and every failure maps onto the frozen `ProviderError` taxonomy
 * with a sanitized message. The Authorization header, API key, and raw
 * response bodies never appear in errors or logs.
 */

const resendSendResponseSchema = z.object({
  // Resend returns {"id": "..."} on accepted sends; anything else is a
  // malformed payload for our purposes.
  id: z.string().min(1),
});

/** Maps an HTTP status to a ProviderErrorKind per TESTING.md §2.3 fixtures. */
function kindForStatus(status: number): ProviderErrorKind {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429 || status >= 500) return "retryable";
  return "permanent";
}

/** Parses JSON text, mapping any parse failure to `null` (malformed). */
function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface ResendEmailSenderOptions {
  readonly clock: Clock;
  /** Test seam: inject a fetch implementation instead of globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Hard deadline for one provider call (default 10s, capped at 60s).
   * A stalled request/response aborts and maps to `timeout` so the
   * serialized send queue never wedges behind a single hung send.
   */
  readonly timeoutMs?: number;
}

export class ResendEmailSender implements EmailSender {
  private readonly clock: Clock;
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /**
   * Sends are queued and flushed sequentially so concurrent callers cannot
   * interleave provider calls; the queue also gives tests a deterministic
   * drain point.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ResendEmailSenderOptions) {
    this.clock = options.clock;
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new ProviderError(
        "permanent",
        { provider: "resend", operation: "configure" },
        "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured for the Resend adapter",
      );
    }
    this.apiKey = env.RESEND_API_KEY;
    this.fromEmail = env.RESEND_FROM_EMAIL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    // A stalled request or response must never block the serialized send
    // queue indefinitely: every deliver() runs under a hard deadline.
    this.timeoutMs = Math.min(Math.max(1, options.timeoutMs ?? 10_000), 60_000);
  }

  send(request: SendEmailRequest): Promise<EmailDeliveryRecord> {
    const result = new Promise<EmailDeliveryRecord>((resolve, reject) => {
      this.queue = this.queue.then(() =>
        this.deliver(request).then(resolve, reject),
      );
    });
    // Keep the chain alive after a rejection so later sends still run.
    this.queue = this.queue.catch(() => undefined);
    return result;
  }

  /** Awaits completion of every previously enqueued send (test seam). */
  flush(): Promise<void> {
    return this.queue.then(
      () => undefined,
      () => undefined,
    );
  }
  private async deliver(request: SendEmailRequest): Promise<EmailDeliveryRecord> {
    let outcome: { response: Response; bodyText: string | null } | undefined;
    // Set when the deadline wins the race; read in the classification
    // below to label the failure `timeout` rather than a generic outage.
    // Held in a box so the abort listener's write stays visible to reads
    // after awaits.
    const abortState = { timedOut: false };
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => {
      abortState.timedOut = true;
    });
    let deadlineTimer: NodeJS.Timeout | undefined;
    try {
      // Bounded deadline covering BOTH phases of the provider call: the
      // request/response round trip AND the body read. A compliant fetch
      // rejects via `signal` in either phase; a non-compliant one (or a
      // stalled body) is still cut off when the timer settles the race
      // with `undefined` — so the serialized send queue can never wedge
      // behind one hung call.
      outcome = await Promise.race([
        this.fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: this.fromEmail,
            to: [request.to],
            subject: request.subject,
            text: request.text,
            ...(request.html === undefined ? {} : { html: request.html }),
            ...(request.attachments === undefined
              ? {}
              : {
                  attachments: request.attachments.map((attachment) => ({
                    filename: attachment.filename,
                    content: attachment.contentBase64,
                    content_type: attachment.contentType,
                  })),
                }),
          }),
          signal: controller.signal,
        }).then(async (settled) => {
          // The Response arriving does NOT end the race: keep it pending
          // until the body text is consumed, so a stalled body stays under
          // the same deadline and abort signal. The read is guarded so a
          // body that ERRORS mid-flight (truncated connection, reset
          // stream) resolves with `null` instead of rejecting — the race's
          // catch would otherwise mislabel it "retryable/unreachable"
          // (cubic PRRT_kwDOT_C_FM6bh9nE): a body we could not fully read
          // can never yield a trustworthy send receipt, so it fails as
          // malformed_response below, exactly like a non-JSON body.
          const bodyText = await settled.text().catch(() => null);
          return { response: settled, bodyText };
        }),
        new Promise<undefined>((resolve) => {
          deadlineTimer = setTimeout(() => {
            controller.abort();
            resolve(undefined);
          }, this.timeoutMs);
        }),
      ]);
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      if (abortState.timedOut) {
        throw new ProviderError(
          "timeout",
          { provider: "resend", operation: "send" },
          "The email provider did not respond in time",
          { cause },
        );
      }
      throw new ProviderError(
        "retryable",
        { provider: "resend", operation: "send" },
        "The email provider is unreachable",
        { cause },
      );
    } finally {
      clearTimeout(deadlineTimer);
    }
    if (outcome === undefined || abortState.timedOut) {
      // The deadline won the race (or the fetch rejected on abort) — the
      // provider did not answer within the budget.
      throw new ProviderError(
        "timeout",
        { provider: "resend", operation: "send" },
        "The email provider did not respond in time",
      );
    }
    this.assertApiKeyNotRejected(outcome.response.status);

    if (!outcome.response.ok) {
      throw new ProviderError(
        kindForStatus(outcome.response.status),
        { provider: "resend", operation: "send" },
        `The email provider rejected the send with HTTP ${String(outcome.response.status)}`,
      );
    }

    // Body text was already buffered inside the raced promise. `null`
    // means the body read itself failed mid-flight (the guarded
    // `.text().catch(() => null)` above); a body that never was JSON (or
    // empty) means the provider answered garbage. Both can never yield a
    // trustworthy send receipt and map to malformed_response — NOT to the
    // race's retryable "unreachable" branch.
    if (outcome.bodyText === null) {
      throw new ProviderError(
        "malformed_response",
        { provider: "resend", operation: "send" },
        "The email provider response body could not be read",
      );
    }
    const parsed = resendSendResponseSchema.safeParse(jsonOrNull(outcome.bodyText));
    if (!parsed.success) {
      throw new ProviderError(
        "malformed_response",
        { provider: "resend", operation: "send" },
        "The email provider returned an unexpected response shape",
      );
    }
    return {
      messageId: parsed.data.id,
      to: request.to,
      subject: request.subject,
      kind: request.kind,
      dedupeKey: request.dedupeKey,
      sentAt: this.clock.now(),
    };
  }

  private assertApiKeyNotRejected(status: number): void {
    if (status === 401 || status === 403) {
      throw new ProviderError(
        "permanent",
        { provider: "resend", operation: "send" },
        "The email provider rejected the sender credentials",
      );
    }
  }
}
