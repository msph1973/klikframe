import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Clock } from "@/lib/shared/clock";
import { getEnv } from "@/lib/config/env";
import { ProviderError } from "@/lib/shared/provider-error";
import type {
  ObjectStorage,
  PresignDownloadRequest,
  PresignUploadRequest,
} from "./storage-port";
import type {
  DeleteOutcome,
  HeadOutcome,
  PresignDownloadOutcome,
  PresignUploadOutcome,
} from "./storage-types";
import { MAX_DOWNLOAD_TTL_MS, MAX_UPLOAD_TTL_MS, storageProviderError } from "./storage-types";

/**
 * Real object-storage adapter for Civo S3 Object Storage (ARCHITECTURE.md
 * §3.5). Civo's endpoint is S3-compatible: the vanilla AWS SDK works when
 * pointed at `S3_ENDPOINT` (DEPLOYMENT.md §3 — the Civo decision replaced
 * the old CloudFront variables). The bucket stays private; delivery is
 * exclusively short-lived presigned download URLs generated on demand.
 *
 * Raw SDK responses never cross this boundary: callers receive the port's
 * typed outcomes and every failure maps onto the frozen `ProviderError`
 * taxonomy with a sanitized message — no XML body, no key dump, no creds.
 */
export interface CivoS3StorageOptions {
  readonly clock: Clock;
  /** Test seam: inject an S3Client (otherwise built from getEnv()). */
  readonly client?: S3Client;
}

const KEY_PATTERN = /^[a-zA-Z0-9/._-]{1,512}$/;

function errorName(cause: unknown): string {
  if (cause !== null && typeof cause === "object" && "name" in cause) {
    const name = (cause as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function s3Error(
  cause: unknown,
  operation: Parameters<typeof storageProviderError>[0],
  message: string,
): ProviderError {
  // Timeout-ish SDK failures surface as retryable timeouts; throttling and
  // service outages stay retryable so post-commit callers can re-run; the
  // remainder is a permanent provider fault under the caller contract.
  if (/Timeout|AbortError|NetworkingError/i.test(errorName(cause))) {
    return new ProviderError("timeout", { provider: "storage", operation }, message, { cause });
  }
  const status = httpStatusOf(cause);
  if (status === 408 || status === 504) {
    return new ProviderError("timeout", { provider: "storage", operation }, message, { cause });
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return new ProviderError("retryable", { provider: "storage", operation }, message, { cause });
  }
  return storageProviderError(operation, message, cause);
}

/** Extracts `$metadata.httpStatusCode` from an SDK service exception. */
function httpStatusOf(cause: unknown): number | null {
  if (cause !== null && typeof cause === "object" && "$metadata" in cause) {
    const metadata: unknown = cause.$metadata;
    if (metadata !== null && typeof metadata === "object" && "httpStatusCode" in metadata) {
      const status: unknown = metadata.httpStatusCode;
      if (typeof status === "number") return status;
    }
  }
  return null;
}

export class CivoS3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly clock: Clock;

  constructor(options: CivoS3StorageOptions) {
    this.clock = options.clock;
    const env = getEnv();
    const bucket = env.S3_BUCKET;
    if (!bucket || !env.S3_ENDPOINT) {
      throw storageProviderError(
        "configure",
        "S3_BUCKET and S3_ENDPOINT must be configured for the storage adapter",
      );
    }
    // Fail fast on missing credentials: an S3Client with empty keys would
    // accept every local call and then fail obscurely at Civo per request.
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw storageProviderError(
        "configure",
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured for the storage adapter",
      );
    }
    this.bucket = bucket;
    this.client =
      options.client ??
      new S3Client({
        region: env.AWS_REGION ?? "us-east-1",
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      });
  }

  async presignUpload(request: PresignUploadRequest): Promise<PresignUploadOutcome> {
    this.assertKey(request.key, "presignUpload");
    if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1) {
      throw storageProviderError("presignUpload", "Upload size must be a positive byte count");
    }
    if (!/^[0-9a-f]{64}$/.test(request.checksumSha256)) {
      throw storageProviderError("presignUpload", "Upload requires a hex-encoded SHA-256 checksum");
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.sizeBytes,
      ChecksumSHA256: Buffer.from(request.checksumSha256, "hex").toString("base64"),
    });
    try {
      // The signature covers the content type so an altered header set fails
      // server-side at Civo exactly like finalize verification would. The
      // checksum header must stay a SIGNED HEADER: the SDK's default
      // "hoisting" moves x-amz-* into the query string and signs that form,
      // which then breaks when the browser sends the same name as a header
      // (Civo answers with a signature error). `unhoistableHeaders` keeps it
      // in the header set the URL was signed for.
      const checksumHeader = Buffer.from(request.checksumSha256, "hex").toString("base64");
      const url = await getSignedUrl(this.client, command, {
        expiresIn: Math.floor(MAX_UPLOAD_TTL_MS / 1000),
        signableHeaders: new Set(["content-type", "x-amz-checksum-sha256"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      });
      return {
        kind: "success",
        method: "PUT",
        url,
        requiredHeaders: {
          "content-type": request.contentType,
          // S3 expects base64 here — the exact value registered on the
          // command and covered by the signature.
          "x-amz-checksum-sha256": checksumHeader,
        },
        expiresAt: new Date(this.clock.now().getTime() + MAX_UPLOAD_TTL_MS),
      };
    } catch (cause) {
      throw s3Error(cause, "presignUpload", "The storage provider rejected the upload presign request");
    }
  }

  async presignDownload(request: PresignDownloadRequest): Promise<PresignDownloadOutcome> {
    this.assertKey(request.key, "presignDownload");
    if (!Number.isInteger(request.expiresInMs) || request.expiresInMs < 1) {
      throw storageProviderError("presignDownload", "Download expiry must be positive");
    }
    const ttlMs = Math.min(request.expiresInMs, MAX_DOWNLOAD_TTL_MS);
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: request.key }),
        { expiresIn: Math.ceil(ttlMs / 1000) },
      );
      return {
        kind: "success",
        url,
        expiresAt: new Date(this.clock.now().getTime() + ttlMs),
      };
    } catch (cause) {
      throw s3Error(cause, "presignDownload", "The storage provider rejected the download presign request");
    }
  }

  async head(key: string): Promise<HeadOutcome | { kind: "not_found" }> {
    this.assertKey(key, "head");
    try {
      // ChecksumMode asks Civo to return the stored checksum so finalize
      // verification can actually compare it; without it the header is
      // absent and every valid object would report checksumSha256: null.
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      return {
        kind: "found",
        sizeBytes: output.ContentLength ?? 0,
        contentType: output.ContentType ?? null,
        checksumSha256: output.ChecksumSHA256
          ? Buffer.from(output.ChecksumSHA256, "base64").toString("hex")
          : null,
      };
    } catch (cause) {
      const marker = `${errorName(cause)} ${cause instanceof Error ? cause.message : ""}`;
      if (/NotFound|\b404\b|NoSuchKey/.test(marker)) {
        // Contract: a missing object is a typed outcome, not a throw.
        return { kind: "not_found" };
      }
      throw s3Error(cause, "head", "The storage provider failed the head request");
    }
  }

  async delete(key: string): Promise<DeleteOutcome> {
    this.assertKey(key, "delete");
    try {
      // Idempotent by contract so orphan cleanup never needs pre-checks
      // (SECURITY.md §4 cleanup flow).
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return { kind: "deleted" };
    } catch (cause) {
      throw s3Error(cause, "delete", "The storage provider failed the delete request");
    }
  }

  private assertKey(key: string, operation: "presignUpload" | "presignDownload" | "head" | "delete"): void {
    if (!KEY_PATTERN.test(key)) {
      throw storageProviderError(operation, "Object key contains unsupported characters");
    }
  }
}
