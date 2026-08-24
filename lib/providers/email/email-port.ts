/**
 * Vendor-neutral transactional email contract (ARCHITECTURE.md §3.7). The
 * Resend adapter (`resend-email-sender.ts`) implements this over the REST
 * API; the capture fake (`fake-email-sender.ts`) records deliveries with
 * deterministic failure injection for fast tests (TESTING.md §2.3).
 */
/** Canonical MVP transactional email kinds (notification_deliveries). */
export const EMAIL_KINDS = [
  "contract_delivery",
  "invoice_issue",
  "invoice_reminder",
  "portal_link",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailAttachment {
  /** Filename is informational only — never part of storage keys. */
  readonly filename: string;
  readonly contentBase64: string;
  readonly contentType: string;
}

export interface SendEmailRequest {
  readonly to: string;
  readonly subject: string;
  /** Pre-rendered text body; HTML variant optional. */
  readonly text: string;
  readonly html?: string;
  /** Ties a send to its `notification_deliveries` row for dedupe/audit. */
  readonly dedupeKey: string;
  readonly kind: EmailKind;
  readonly attachments?: readonly EmailAttachment[];
}

export interface EmailDeliveryRecord {
  /**
   * Provider-agnostic message id. The Resend adapter forwards the
   * provider's id verbatim; the capture fake derives one deterministically
   * from the dedupe key. Ids are opaque — never logged alongside PII.
   */
  readonly messageId: string;
  readonly to: string;
  readonly subject: string;
  readonly kind: EmailKind;
  readonly dedupeKey: string;
  /** Deterministic send timestamp from the injected clock. */
  readonly sentAt: Date;
}

export interface EmailSender {
  /**
   * Sends one transactional email. Throws `ProviderError` (frozen taxonomy,
   * sanitized messages) on provider faults; success returns the delivery
   * record for persistence.
   */
  send(request: SendEmailRequest): Promise<EmailDeliveryRecord>;
}
