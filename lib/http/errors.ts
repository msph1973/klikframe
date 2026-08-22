/**
 * Frozen error envelope contract (API_SPEC.md §1.2). Every `/api/v1`
 * failure — including provider/route shells landing in later Phase 0
 * waves — MUST map to one of these codes; no error may leak stack traces,
 * provider detail, or cross-workspace existence.
 */
export const ERROR_STATUS_MAP = {
  INVALID_INPUT: 400,
  INVALID_CURSOR: 400,
  AUTH_REQUIRED: 401,
  PORTAL_TOKEN_INVALID: 401,
  PORTAL_TOKEN_EXPIRED: 401,
  MEMBERSHIP_INACTIVE: 403,
  PORTAL_SCOPE_DENIED: 403,
  ORIGIN_DENIED: 403,
  CSRF_INVALID: 403,
  UPLOAD_CAPABILITY_INVALID: 403,
  RESOURCE_NOT_FOUND: 404,
  ALREADY_ONBOARDED: 409,
  DUPLICATE_CONTACT: 409,
  INVALID_STATE_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UPLOAD_EXPIRED: 410,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CHECKSUM_MISMATCH: 422,
  UPLOAD_NOT_FOUND: 422,
  RATE_LIMITED: 429,
  PRECONDITION_FAILED: 412,
  PRECONDITION_REQUIRED: 428,
  DEPENDENCY_UNAVAILABLE: 503,
  // Extension beyond API_SPEC.md's table: a sanitized catch-all for
  // defects that must never reach the client as a raw stack/message.
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS_MAP;
export type ErrorStatus = (typeof ERROR_STATUS_MAP)[ErrorCode];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id: string | null;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS_MAP[code];
    this.details = details;
  }

  /**
   * Maps any thrown value to a client-safe `AppError`. Non-`AppError`
   * causes are collapsed to a generic message so internals never leak.
   */
  static from(cause: unknown): AppError {
    if (cause instanceof AppError) return cause;
    return new AppError("INTERNAL_ERROR", "Internal server error");
  }
}

export function toErrorEnvelope(error: AppError, requestId: string | null): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      request_id: requestId,
    },
  };
}
