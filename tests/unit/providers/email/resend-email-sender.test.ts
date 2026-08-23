import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../lib/shared/clock";
import { resetEnvCacheForTests } from "../../../../lib/config/env";
import { ResendEmailSender } from "../../../../lib/providers/email/resend-email-sender";

const BASE = new Date("2026-08-20T10:00:00.000Z");

function envResend(): void {
  process.env.RESEND_API_KEY = ["re", "test", "key", "placeholder"].join("_");
  process.env.RESEND_FROM_EMAIL = ["no-reply", "klikframe.test"].join("@");
  resetEnvCacheForTests();
}

describe("ResendEmailSender contract (injected fetch)", () => {
  it("fails construction when RESEND env pair is missing", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    resetEnvCacheForTests();
    expect(() => new ResendEmailSender({ clock: new FixedClock(BASE) })).toThrow(/RESEND_API_KEY/);
    envResend();
  });

  it("sends one POST per message and returns the delivery record", async () => {
    envResend();
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      await Promise.resolve();
      bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    }) as typeof fetch;
    const sender = new ResendEmailSender({ clock: new FixedClock(BASE), fetchImpl });
    const record = await sender.send({
      to: "client@example.com",
      subject: "Kontrak siap ditandatangani",
      text: "Silakan buka portal.",
      dedupeKey: "contract_delivery:c1:2026-08-20",
      kind: "contract_delivery",
    });
    expect(record.messageId).toBe("msg_123");
    expect(record.kind).toBe("contract_delivery");
    expect(record.sentAt.getTime()).toBe(BASE.getTime());
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Record<string, unknown>;
    // From comes from canonical env; recipient and content from the request.
    expect(body.from).toBe("no-reply@klikframe.test");
    expect(JSON.stringify(body)).not.toContain("re_test_key_placeholder");
  });

  it("maps HTTP 429 to a retryable ProviderError without leaking the key", async () => {
    envResend();
    const fetchImpl = (async () => {
      await Promise.resolve();
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;
    const sender = new ResendEmailSender({ clock: new FixedClock(BASE), fetchImpl });
    try {
      await sender.send({
        to: "client@example.com",
        subject: "s",
        text: "t",
        dedupeKey: "k1",
        kind: "invoice_reminder",
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as { kind?: string }).kind).toBe("retryable");
      expect(String(error)).not.toContain("re_test_key_placeholder");
    }
  });

  it("maps a malformed success body to malformed_response", async () => {
    envResend();
    const fetchImpl = (async () => {
      await Promise.resolve();
      return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    }) as typeof fetch;
    const sender = new ResendEmailSender({ clock: new FixedClock(BASE), fetchImpl });
    await expect(
      sender.send({
        to: "client@example.com",
        subject: "s",
        text: "t",
        dedupeKey: "k2",
        kind: "portal_link",
      }),
    ).rejects.toMatchObject({ kind: "malformed_response", provider: "resend" });
  });
  it("aborts a stalled response under the deadline and maps it to timeout", async () => {
    envResend();
    let call = 0;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("This operation was aborted"));
          });
        });
      }
      // Recovery mode: respond normally so the queue proves it unwedged.
      return new Response(JSON.stringify({ id: "msg_ok" }), { status: 200 });
    }) as typeof fetch;
    const sender = new ResendEmailSender({
      clock: new FixedClock(BASE),
      fetchImpl,
      timeoutMs: 25,
    });
    await expect(
      sender.send({
        to: "client@example.com",
        subject: "s",
        text: "t",
        dedupeKey: "k3",
        kind: "portal_link",
      }),
    ).rejects.toMatchObject({ kind: "timeout", isRetryable: true });
    // A timed-out send must not wedge the serialized queue: the next
    // message still delivers.
    const recovered = await sender.send({
      to: "client@example.com",
      subject: "s",
      text: "t",
      dedupeKey: "k4",
      kind: "portal_link",
    });
    expect(recovered.messageId).toBe("msg_ok");
  });
});
