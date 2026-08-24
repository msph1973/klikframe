import type { Clock } from "@/lib/shared/clock";
import { ProviderError } from "@/lib/shared/provider-error";
import type { PresignDownloadRequest, PresignUploadRequest } from "./storage-port";
import type {
  DeleteOutcome,
  HeadOutcome,
  PresignDownloadOutcome,
  PresignUploadOutcome,
} from "./storage-types";
import { MAX_DOWNLOAD_TTL_MS, MAX_UPLOAD_TTL_MS } from "./storage-types";

/**
 * Deterministic in-memory object store (TESTING.md §2.3 "fake object
 * adapter"). Mirrors the Civo adapter's observable contract without
 * network or real signatures:
 * - presigned URLs are `https://fake-storage.internal/<op>/<key>?...`
 *   carrying an expiry epoch and a sequential nonce,
 * - expiry is enforced at consume time exactly like a real expired
 *   signature (S3 answers 403; here it surfaces through the taxonomy),
 * - head/delete of a nonexistent key resolve to `not_found`/`deleted`
 *   instead of throwing.
 * Deterministic: injectable Clock, counter-based URL nonces, no timers.
 */
interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly checksumSha256: string;
}

const KEY_PATTERN = /^[a-zA-Z0-9/._-]{1,512}$/;

export class FakeObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private urlCounter = 0;

  constructor(private readonly clock: Clock) {}

  async presignUpload(request: PresignUploadRequest): Promise<PresignUploadOutcome> {
    await Promise.resolve();
    this.assertKey(request.key, "presignUpload");
    if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignUpload" },
        "Upload requires a positive integer size",
      );
    }
    if (!/^[0-9a-f]{64}$/.test(request.checksumSha256)) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignUpload" },
        "Upload requires a hex-encoded SHA-256 checksum",
      );
    }
    const expiresAtMs = this.clock.now().getTime() + MAX_UPLOAD_TTL_MS;
    return {
      kind: "success",
      method: "PUT",
      url: fakeUrl("upload", request.key, expiresAtMs, this.urlCounter++),
      requiredHeaders: {
        "content-type": request.contentType,
        "x-amz-checksum-sha256": request.checksumSha256,
      },
      expiresAt: new Date(expiresAtMs),
    };
  }

  async presignDownload(request: PresignDownloadRequest): Promise<PresignDownloadOutcome> {
    await Promise.resolve();
    this.assertKey(request.key, "presignDownload");
    if (!Number.isInteger(request.expiresInMs) || request.expiresInMs < 1) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignDownload" },
        "Download expiry must be positive",
      );
    }
    const ttlMs = Math.min(request.expiresInMs, MAX_DOWNLOAD_TTL_MS);
    const expiresAtMs = this.clock.now().getTime() + ttlMs;
    return {
      kind: "success",
      url: fakeUrl("download", request.key, expiresAtMs, this.urlCounter++),
      expiresAt: new Date(expiresAtMs),
    };
  }

  async head(key: string): Promise<HeadOutcome | { kind: "not_found" }> {
    await Promise.resolve();
    // Mirrors the Civo adapter: unsafe keys are rejected before any lookup,
    // so tests cannot accept keys production would refuse.
    this.assertKey(key, "head");
    const stored = this.objects.get(key);
    // Contract: head of a nonexistent key is a typed outcome, not a throw.
    if (!stored) return { kind: "not_found" };
    return {
      kind: "found",
      sizeBytes: stored.sizeBytes,
      contentType: stored.contentType,
      checksumSha256: stored.checksumSha256,
    };
  }

  async delete(key: string): Promise<DeleteOutcome> {
    await Promise.resolve();
    this.assertKey(key, "delete");
    // Idempotent by contract so orphan cleanup never needs pre-checks.
    this.objects.delete(key);
    return { kind: "deleted" };
  }

  /**
   * Test seam: simulates the browser's direct PUT against a presigned
   * upload URL. Enforces the same checks Civo would — unexpired signature,
   * matching content type and checksum — then registers the object.
   */
  async consumePresignedUpload(input: {
    readonly outcome: PresignUploadOutcome;
    readonly key: string;
    readonly sizeBytes: number;
    readonly contentType: string;
    readonly checksumSha256: string;
  }): Promise<void> {
    await Promise.resolve();
    assertUnexpired(input.outcome.url, this.clock.now().getTime(), "presignUpload");
    if (urlKeyOf(input.outcome.url, "upload") !== input.key) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignUpload" },
        "The upload URL does not reference the requested key",
      );
    }
    if (input.contentType !== input.outcome.requiredHeaders["content-type"]) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignUpload" },
        "Content-Type does not match the presigned policy",
      );
    }
    if (input.checksumSha256 !== input.outcome.requiredHeaders["x-amz-checksum-sha256"]) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation: "presignUpload" },
        "Checksum does not match the presigned policy",
      );
    }
    this.objects.set(input.key, {
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      checksumSha256: input.checksumSha256,
    });
  }

  /**
   * Test seam: simulates a GET against a presigned download URL. A
   * structurally invalid URL surfaces as the sanitized malformed_response
   * branch (the same taxonomy the real adapter uses for unparseable
   * provider responses) instead of a raw TypeError from `new URL`
   * (cubic PRRT_kwDOT_C_FM6bh9nz); a parseable URL that references no
   * known object stays a permanent capability error, and an expired
   * signature is rejected before object lookup (cubic FM6biwyg).
   */
  async consumePresignedDownload(url: string): Promise<StoredObject & { key: string }> {
    await Promise.resolve();
    // Expiry is checked BEFORE the URL is matched to an object: a signed
    // capability past its TTL must be rejected even when it still names a
    // live object, exactly like S3 answering 403 on an expired signature
    // (cubic PRRT_kwDOT_C_FM6biwyg).
    assertUnexpired(url, this.clock.now().getTime(), "presignDownload");
    const key = urlKeyOf(url, "download");
    if (key !== null) {
      const stored = this.objects.get(key);
      if (stored) return { ...stored, key };
    }
    throw new ProviderError(
      "permanent",
      { provider: "storage", operation: "presignDownload" },
      "The download URL does not reference a known object",
    );
  }

  /** Number of registered objects (test assertions). */
  get objectCount(): number {
    return this.objects.size;
  }

  private assertKey(
    key: string,
    operation: "presignUpload" | "presignDownload" | "head" | "delete",
  ): void {
    if (!KEY_PATTERN.test(key)) {
      throw new ProviderError(
        "permanent",
        { provider: "storage", operation },
        "Object key contains unsupported characters",
      );
    }
  }
}

function fakeUrl(operation: string, key: string, expiresAtMs: number, nonce: number): string {
  const params = new URLSearchParams({
    expires: String(expiresAtMs),
    nonce: String(nonce),
  });
  return `https://fake-storage.internal/${operation}/${encodeURIComponent(key)}?${params.toString()}`;
}

/**
 * Parses `<op>/<encodedKey>` out of the URL pathname; returns null when
 * the operation segment differs or the path does not have exactly two
 * segments. Malformed URLs surface through `assertUnexpired` first.
 */
function urlKeyOf(url: string, operation: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2 || segments[0] !== operation) {
    return null;
  }
  try {
    return decodeURIComponent(segments[1] ?? "");
  } catch {
    return null;
  }
}

function assertUnexpired(url: string, nowMs: number, operation: string): void {
  // A structurally invalid URL must surface as the sanitized
  // malformed_response branch, not as an unhandled TypeError from the
  // URL constructor.
  let expires: number;
  try {
    expires = Number(new URL(url).searchParams.get("expires"));
  } catch {
    throw new ProviderError(
      "malformed_response",
      { provider: "storage", operation },
      "The storage URL is not a valid URL",
    );
  }
  if (!Number.isFinite(expires)) {
    throw new ProviderError(
      "malformed_response",
      { provider: "storage", operation },
      "The storage URL does not carry an expiry claim",
    );
  }
  if (nowMs >= expires) {
    throw new ProviderError(
      "permanent",
      { provider: "storage", operation },
      "The storage URL has expired",
    );
  }
}
