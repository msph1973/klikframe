import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../../lib/shared/clock";
import {
  FakeEmailSender,
} from "../../../../lib/providers/email/fake-email-sender";
import type { SendEmailRequest } from "../../../../lib/providers/email/email-port";

const BASE = new Date("2026-08-20T10:00:00.000Z");

function request(overrides: Partial<SendEmailRequest> = {}): SendEmailRequest {
  return {
    to: "owner@example.com",
    subject: "Invoice INV-1 issued",
    text: "Your invoice is ready.",
    dedupeKey: "invoice_reminder:inv-1:owner@example.com:2026-08-20",
    kind: "invoice_issue",
    ...overrides,
  };
}

function sender(): FakeEmailSender {
  return new FakeEmailSender(new FixedClock(BASE));
}

describe("FakeEmailSender — capture", () => {
  it("records the delivery with a deterministic message id shape", async () => {
    const fake = sender();
    const record = await fake.send(request());
    expect(record.to).toBe("owner@example.com");
    expect(record.kind).toBe("invoice_issue");
    expect(record.dedupeKey).toContain("inv-1");
    expect(record.messageId).toMatch(/^fake-[0-9a-f]{24}$/);
    expect(record.sentAt.getTime()).toBe(BASE.getTime());
    expect(fake.deliveries).toHaveLength(1);
  });

  it("derives identical message ids from identical dedupe keys", async () => {
    const fake = sender();
    const first = await fake.send(request());
    const replay = await fake.send(request());
    expect(replay.messageId).toBe(first.messageId);
    expect(fake.deliveries).toHaveLength(2);
  });
});

describe("FakeEmailSender — deterministic failure injection", () => {
  it("fails the next send with a retryable ProviderError", async () => {
    const fake = sender();
    fake.failNext(1, "retryable");
    await expect(fake.send(request())).rejects.toMatchObject({
      kind: "retryable",
      provider: "resend",
      operation: "send",
    });
    // Injection is consumed: the following send succeeds.
    const record = await fake.send(request());
    expect(record.messageId).toMatch(/^fake-/);
  });

  it("supports permanent and malformed_response kinds", async () => {
    const fake = sender();
    fake.failNext(1, "permanent");
    await expect(fake.send(request())).rejects.toMatchObject({ kind: "permanent" });
    fake.failNext(1, "malformed_response");
    await expect(fake.send(request())).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("injects timeouts as timeout-kind provider errors", async () => {
    const fake = sender();
    fake.timeoutNext(2);
    await expect(fake.send(request())).rejects.toMatchObject({
      kind: "timeout",
      isRetryable: true,
    });
    await expect(fake.send(request())).rejects.toMatchObject({ kind: "timeout" });
    expect(fake.hasPendingFailures).toBe(false);
    await expect(fake.send(request())).resolves.toBeDefined();
  });

  it("keeps failed sends out of the delivery log", async () => {
    const fake = sender();
    fake.failNext(1, "permanent");
    await expect(fake.send(request())).rejects.toThrow();
    expect(fake.deliveries).toHaveLength(0);
    expect(await fake.send(request())).toBeDefined();
    expect(fake.deliveries).toHaveLength(1);
  });
});
