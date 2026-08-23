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
    let response: Response | undefined;
    // Set when the deadline wins the race; read in the catch below to
    // classify the failure as `timeout` rather than a generic outage.
    let timedOut = false;
    let deadlineTimer: NodeJS.Timeout | undefined;
    try {
      // Bounded deadline: a stalled request or response aborts here and
      // maps to `timeout`, so the serialized queue can never wedge behind
      // one hung call.
      const controller = new AbortController();
      controller.signal.addEventListener("abort", () => {
        timedOut = true;
      });
      try {
        // Race the call against the deadline: a compliant fetch rejects
        // via `signal`, and a non-compliant one (or a stalled body) is
        // still cut off when the timer settles the race with `undefined`.
        response = await Promise.race([
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
          }),
          new Promise<undefined>((resolve) => {
            deadlineTimer = setTimeout(() => {
              resolve(undefined);
            }, this.timeoutMs);
          }),
        ]);
        if (response === undefined) {
          timedOut = true;
        }
      } finally {
        clearTimeout(deadlineTimer);
      }
      if (response === undefined) {
        // The deadline won the race — the provider never responded.
        throw new ProviderError(
          "timeout",
          { provider: "resend", operation: "send" },
          "The email provider did not respond in time",
        );
      }
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      if (timedOut) {
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
    }
    this.assertApiKeyNotRejected(response.status);

    if (!response.ok) {
      throw new ProviderError(
        kindForStatus(response.status),
        { provider: "resend", operation: "send" },
        `The email provider rejected the send with HTTP ${String(response.status)}`,
      );
    }

    const body: unknown = await response.json().catch(() => null);
    const parsed = resendSendResponseSchema.safeParse(body);
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
