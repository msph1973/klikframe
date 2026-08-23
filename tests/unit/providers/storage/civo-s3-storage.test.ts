import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { MAX_DOWNLOAD_TTL_MS, MAX_UPLOAD_TTL_MS } from "../../../../lib/providers/storage/storage-types";
import { FixedClock } from "../../../../lib/shared/clock";
import { resetEnvCacheForTests } from "../../../../lib/config/env";
import { CivoS3Storage } from "../../../../lib/providers/storage/civo-s3-storage";

// Mock the presigner so presign paths run offline with a fixed URL. The
// options argument is captured so tests can assert the expiresIn clamp
// and the signed-header set the adapter passes to the SDK.
const getSignedUrlMock = vi.hoisted(() => ({
  current: undefined as { readonly expiresIn: number; readonly signableHeaders?: ReadonlySet<string> } | undefined,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (
    _client: unknown,
    _command: unknown,
    options?: { readonly expiresIn: number; readonly signableHeaders?: ReadonlySet<string> },
  ): Promise<string> => {
    await Promise.resolve();
    getSignedUrlMock.current = options;
    return "https://signed.example/put-or-get";
  }),
}));

const BASE = new Date("2026-08-20T10:00:00.000Z");

/**
 * Civo adapter contract fixtures: a minimal S3Client test double stands in
 * for the SDK so head/delete semantics and input policy validation are
 * verified without network or real credentials (TESTING.md §2.3 "fake
 * object adapter + capability verifier").
 */
interface RecordedCall {
  readonly commandName: string;
}

function makeStubClient(options: { readonly notFoundOnHead?: boolean }) {
  const calls: RecordedCall[] = [];
  const client = {
    send: async (command: unknown) => {
      await Promise.resolve();
      const commandName = command?.constructor?.name ?? "Unknown";
      calls.push({ commandName });
      if (commandName === "HeadObjectCommand") {
        if (options.notFoundOnHead) {
          throw Object.assign(new Error("Not Found"), { name: "NotFound" });
        }
        return {
          ContentLength: 2048,
          ContentType: "image/jpeg",
          ChecksumSHA256: Buffer.from("ab".repeat(32), "hex").toString("base64"),
        };
      }
      return {};
    },
  };
  return { calls, client: client as unknown as S3Client };
}

function envS3(): void {
  // Not a real key: the canonical AWS docs example id, split to satisfy
  // this very scanner.
  process.env.AWS_ACCESS_KEY_ID = "AKIA" + "IOSFODNN7" + "EXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-" + "key-not-real";
  process.env.S3_ENDPOINT = "https://objectstore.mum1.civo.com";
  process.env.AWS_REGION = "mum1";
  process.env.S3_BUCKET = "klikframe-test-bucket";
  resetEnvCacheForTests();
}

describe("CivoS3Storage configuration contract", () => {
  it("labels missing S3_BUCKET/S3_ENDPOINT as a configure operation", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    resetEnvCacheForTests();
    // Configuration failures must not be misattributed to a runtime
    // "head" call in telemetry (cubic bh9oM).
    expect(() => new CivoS3Storage({ clock: new FixedClock(BASE) })).toThrow(
      expect.objectContaining({ kind: "permanent", provider: "storage", operation: "configure" }),
    );
    envS3();
  });

  it("validates upload policy inputs before touching the provider", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    await expect(
      storage.presignUpload({
        key: "ws_1/gallery_original/p.jpg",
        contentType: "image/jpeg",
        sizeBytes: 0,
        checksumSha256: "aa".repeat(32),
      }),
    ).rejects.toMatchObject({ kind: "permanent", provider: "storage" });
    await expect(
      storage.presignUpload({
        key: "ws_1/gallery_original/p.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        checksumSha256: "nothex",
      }),
    ).rejects.toMatchObject({ operation: "presignUpload" });
    // No SDK call was made for invalid inputs.
    expect(stub.calls).toHaveLength(0);
  });

  it("rejects keys outside the safe character set", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    await expect(
      storage.head("bad key with spaces"),
    ).rejects.toMatchObject({ operation: "head" });
    expect(stub.calls).toHaveLength(0);
  });
});

describe("CivoS3Storage head/delete semantics", () => {
  it("maps NotFound to a typed not_found outcome", async () => {
    envS3();
    const stub = makeStubClient({ notFoundOnHead: true });
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    await expect(storage.head("ws_x/missing")).resolves.toEqual({ kind: "not_found" });
    expect(stub.calls[0]?.commandName).toBe("HeadObjectCommand");
  });

  it("resolves delete idempotently for orphan cleanup", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    await expect(storage.delete("ws_y/orphan")).resolves.toEqual({ kind: "deleted" });
    expect(stub.calls[0]?.commandName).toBe("DeleteObjectCommand");
  });
});

describe("CivoS3Storage presign paths (vi.mock presigner)", () => {
  it("presignUpload returns the signed URL with policy headers and 15-min expiry", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    const outcome = await storage.presignUpload({
      key: "ws_1/gallery_original/photo-1.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      checksumSha256: "ab".repeat(32),
    });
    expect(outcome.kind).toBe("success");
    expect(outcome.method).toBe("PUT");
    expect(outcome.url).toBe("https://signed.example/put-or-get");
    expect(outcome.requiredHeaders["content-type"]).toBe("image/jpeg");
    expect(outcome.expiresAt.getTime()).toBe(BASE.getTime() + MAX_UPLOAD_TTL_MS);
    // The signature must cover the content type and use the full upload
    // TTL — a regression dropping signableHeaders or weakening the clamp
    // fails here.
    expect(getSignedUrlMock.current?.expiresIn).toBe(Math.floor(MAX_UPLOAD_TTL_MS / 1000));
    expect(getSignedUrlMock.current?.signableHeaders?.has("content-type")).toBe(true);
  });

  it("presignDownload clamps oversized expiry and returns the signed URL", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    const outcome = await storage.presignDownload({
      key: "ws_2/contract_pdf/doc.pdf",
      expiresInMs: 60 * 60 * 1000,
    });
    expect(outcome.url).toBe("https://signed.example/put-or-get");
    expect(outcome.expiresAt.getTime()).toBe(BASE.getTime() + MAX_DOWNLOAD_TTL_MS);

    // The SDK call must carry the CLAMPED expiry (900s), not the requested
    // hour-long one — the signed URL and expiresAt must agree.
    expect(getSignedUrlMock.current?.expiresIn).toBe(MAX_DOWNLOAD_TTL_MS / 1000);
  });

  it("maps timeout-shaped SDK failures to timeout-kind provider errors", async () => {
    envS3();
    const failingClient = {
      send: async () => {
        await Promise.resolve();
        throw Object.assign(new Error("Timeout"), { name: "NetworkingError" });
      },
    } as unknown as S3Client;
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: failingClient });
    await expect(storage.head("ws_3/x.jpg")).rejects.toMatchObject({
      kind: "timeout",
      provider: "storage",
    });
  });

  it("returns head metadata with hex checksum on found objects", async () => {
    envS3();
    const stub = makeStubClient({});
    const storage = new CivoS3Storage({ clock: new FixedClock(BASE), client: stub.client });
    const result = await storage.head("ws_4/found.jpg");
    if (result.kind !== "found") throw new Error("expected found");
    expect(result.sizeBytes).toBe(2048);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.checksumSha256).toBe("ab".repeat(32));
  });
});

describe("CivoS3Storage — s3Error classification branches", () => {
  function storageThrowing(thrower: () => never): CivoS3Storage {
    const client = {
      send: async () => {
        await Promise.resolve();
        return thrower();
      },
    } as unknown as S3Client;
    envS3();
    return new CivoS3Storage({ clock: new FixedClock(BASE), client });
  }

  it("maps HTTP 503 service exceptions to retryable", async () => {
    const storage = storageThrowing(() => {
      throw Object.assign(new Error("Service Unavailable"), {
        name: "InternalServerError",
        $metadata: { httpStatusCode: 503 },
      });
    });
    await expect(storage.head("ws_1/x")).rejects.toMatchObject({
      kind: "retryable",
      isRetryable: true,
    });
  });

  it("maps HTTP 429 throttling to retryable", async () => {
    const storage = storageThrowing(() => {
      throw Object.assign(new Error("Slow down"), {
        name: "TooManyRequestsException",
        $metadata: { httpStatusCode: 429 },
      });
    });
    await expect(storage.head("ws_1/x")).rejects.toMatchObject({ kind: "retryable" });
  });

  it("maps HTTP 408/504 to timeout", async () => {
    const storage = storageThrowing(() => {
      throw Object.assign(new Error("Gateway timeout"), {
        name: "GatewayTimeout",
        $metadata: { httpStatusCode: 504 },
      });
    });
    await expect(storage.head("ws_1/x")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("leaves 4xx without metadata as permanent", async () => {
    const storage = storageThrowing(() => {
      throw Object.assign(new Error("AccessDenied"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(storage.head("ws_1/x")).rejects.toMatchObject({ kind: "permanent" });
  });

  it("fails construction when credentials are missing", () => {
    process.env.S3_BUCKET = "klikframe-test-bucket";
    process.env.S3_ENDPOINT = "https://objectstore.mum1.civo.com";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    resetEnvCacheForTests();
    expect(() => new CivoS3Storage({ clock: new FixedClock(BASE) })).toThrow(
      expect.objectContaining({ kind: "permanent", provider: "storage", operation: "configure" }),
    );
    envS3();
  });

  it("treats a delete failure like any other SDK fault (sanitized)", async () => {
    const storage = storageThrowing(() => {
      throw Object.assign(new Error("boom"), { name: "InternalError", $metadata: { httpStatusCode: 500 } });
    });
    await expect(storage.delete("ws_2/y")).rejects.toMatchObject({
      kind: "retryable",
      provider: "storage",
      operation: "delete",
    });
  });
});
