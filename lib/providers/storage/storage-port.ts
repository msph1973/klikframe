/**
 * Vendor-neutral object-storage contract (ARCHITECTURE.md §3.5, SECURITY.md
 * §4). The Civo S3-compatible adapter (`civo-s3-storage.ts`) implements this
 * with @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner pointed at
 * `S3_ENDPOINT`; the deterministic fake (`fake-object-storage.ts`) mirrors
 * the observable contract for fast tests (TESTING.md §2.3).
 *
 * Delivery is always a server-generated presigned download URL with expiry —
 * never a stored/permanent URL (Civo has no built-in CDN; the canonical
 * DEPLOYMENT.md §3 environment replaced CloudFront with `S3_ENDPOINT`).
 */
import type {
  DeleteOutcome,
  HeadOutcome,
  PresignDownloadOutcome,
  PresignUploadOutcome,
} from "./storage-types";

/** Canonical upload purposes (API_SPEC.md §9.4 purpose matrix). */
export const STORAGE_PURPOSES = [
  "gallery_original",
  "contract_pdf",
  "signature",
  "payment_proof",
  "gallery_thumbnail",
] as const;
export type StoragePurpose = (typeof STORAGE_PURPOSES)[number];

export interface PresignUploadRequest {
  /** Full object key, already workspace/purpose-scoped by the caller. */
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Hex-encoded SHA-256 checksum of the exact bytes to be uploaded. */
  readonly checksumSha256: string;
}

export interface PresignDownloadRequest {
  readonly key: string;
  /** Download lifetime in ms; each implementation caps it (≤15 min). */
  readonly expiresInMs: number;
}

/**
 * Shared port surface. Implementations throw `ProviderError` for provider
 * faults and return typed outcomes for expected states (`not_found`,
 * `deleted`) so callers never branch on vendor errors.
 */
export interface ObjectStorage {
  presignUpload(request: PresignUploadRequest): Promise<PresignUploadOutcome>;
  presignDownload(request: PresignDownloadRequest): Promise<PresignDownloadOutcome>;
  head(key: string): Promise<HeadOutcome | { kind: "not_found" }>;
  delete(key: string): Promise<DeleteOutcome>;
}

/**
 * Canonical S3 key prefix for an upload purpose:
 * `<workspaceId>/<purpose>/`. SECURITY.md §4 requires keys to live under a
 * workspace/purpose prefix with random names.
 */
export function storageKeyPrefix(workspaceId: string, purpose: StoragePurpose): string {
  return `${workspaceId}/${purpose}/`;
}
