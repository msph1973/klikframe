/**
 * Shared storage-port types (ARCHITECTURE.md §3.5, SECURITY.md §4). Every
 * implementation — the Civo S3 adapter and the deterministic fake — uses
 * these outcome shapes, so callers and contract tests stay
 * provider-agnostic (TESTING.md §2.3).
 */
import { ProviderError } from "@/lib/shared/provider-error";

export type StorageOperation = "presignUpload" | "presignDownload" | "head" | "delete";
export interface PresignUploadOutcome {
  readonly kind: "success";
  readonly method: "PUT";
  readonly url: string;
  /** Headers the uploader MUST send verbatim on the PUT. */
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface PresignDownloadOutcome {
  readonly kind: "success";
  readonly url: string;
  readonly expiresAt: Date;
}

export interface HeadOutcome {
  readonly kind: "found";
  readonly sizeBytes: number;
  readonly contentType: string | null;
  readonly checksumSha256: string | null;
}

export interface DeleteOutcome {
  readonly kind: "deleted";
}

/**
 * Maximum presigned download lifetime (SECURITY.md §4 "expiry singkat");
 * presigned upload URLs share the same cap.
 */
export const MAX_DOWNLOAD_TTL_MS = 15 * 60 * 1000;
export const MAX_UPLOAD_TTL_MS = 15 * 60 * 1000;

/** Maps any raw storage failure into the frozen taxonomy with a sanitized message. */
export function storageProviderError(
  operation: StorageOperation,
  message: string,
  cause?: unknown,
): ProviderError {
  return new ProviderError(
    "permanent",
    { provider: "storage", operation },
    message,
    cause === undefined ? undefined : { cause },
  );
}
