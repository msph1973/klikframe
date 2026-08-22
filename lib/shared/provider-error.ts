/**
 * Frozen provider error taxonomy (TESTING.md §2.3: "timeout, retryable
 * error, permanent error, malformed response"). Every provider adapter
 * (Managed Better Auth, Upstash, S3/CloudFront, Resend, Ably) maps its raw
 * SDK/HTTP errors to this shape so callers never branch on vendor-specific
 * error types. Messages MUST be sanitized by the adapter before wrapping —
 * this class never accepts raw provider payloads/secrets as `message`.
 */
export type ProviderErrorKind = "timeout" | "retryable" | "permanent" | "malformed_response";

export interface ProviderErrorContext {
  readonly provider: string;
  readonly operation: string;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly operation: string;

  constructor(
    kind: ProviderErrorKind,
    context: ProviderErrorContext,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = context.provider;
    this.operation = context.operation;
  }

  get isRetryable(): boolean {
    return this.kind === "timeout" || this.kind === "retryable";
  }
}
