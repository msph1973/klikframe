import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { FixedClock } from "../../../../lib/shared/clock";
import { FakeObjectStorage } from "../../../../lib/providers/storage/fake-object-storage";
import { storageKeyPrefix } from "../../../../lib/providers/storage/storage-port";

const BASE = new Date("2026-08-20T10:00:00.000Z");
const CHECKSUM = createHash("sha256").update("klikframe-photo").digest("hex");

function storage() {
  return new FakeObjectStorage(new FixedClock(BASE));
}

describe("FakeObjectStorage — presign round-trip", () => {
  it("round-trips a presigned upload into head-able state", async () => {
    const store = storage();
    const key = `${storageKeyPrefix("ws_1", "gallery_original")}photo-001`;
    const outcome = await store.presignUpload({
      key,
      contentType: "image/jpeg",
      sizeBytes: 2048,
      checksumSha256: CHECKSUM,
    });
    expect(outcome.kind).toBe("success");
    expect(outcome.method).toBe("PUT");
    expect(outcome.requiredHeaders["content-type"]).toBe("image/jpeg");
    expect(outcome.requiredHeaders["x-amz-checksum-sha256"]).toBe(CHECKSUM);

    await store.consumePresignedUpload({
      outcome,
      key,
      sizeBytes: 2048,
      contentType: "image/jpeg",
      checksumSha256: CHECKSUM,
    });

    const head = await store.head(key);
    expect(head).toMatchObject({ kind: "found", sizeBytes: 2048, contentType: "image/jpeg" });
  });

  it("issues presigned download URLs capped at the 15-minute maximum", async () => {
    const store = storage();
    const download = await store.presignDownload({ key: "ws_1/gallery_original/p", expiresInMs: 60 * 60 * 1000 });
    expect(download.kind).toBe("success");
    // Requested 60 min; contract clamps to ≤15 min (SECURITY.md §4).
    expect(download.expiresAt.getTime() - BASE.getTime()).toBe(15 * 60 * 1000);
  });

  it("rejects an altered content type or checksum at consume time", async () => {
    const store = storage();
    const outcome = await store.presignUpload({
      key: "ws_1/signature/s1.png",
      contentType: "image/png",
      sizeBytes: 512,
      checksumSha256: CHECKSUM,
    });
    await expect(
      store.consumePresignedUpload({
        outcome,
        key: "ws_1/signature/s1.png",
        sizeBytes: 512,
        contentType: "application/pdf",
        checksumSha256: CHECKSUM,
      }),
    ).rejects.toMatchObject({ provider: "storage" });
    expect(await store.head("ws_1/signature/s1.png")).toEqual({ kind: "not_found" });
  });
});

describe("FakeObjectStorage — expiry enforcement", () => {
  it("rejects consumption of an expired upload URL", async () => {
    const clockStorage = new FakeObjectStorage(new FixedClock(BASE));
    const outcome = await clockStorage.presignUpload({
      key: "ws_2/contract_pdf/c.pdf",
      contentType: "application/pdf",
      sizeBytes: 4096,
      checksumSha256: CHECKSUM,
    });
    // Move "now" past expiresAt via a fresh limiter-style clock swap.
    const lateStore = new FakeObjectStorage(
      new FixedClock(new Date(BASE.getTime() + 16 * 60 * 1000)),
    );
    await expect(
      // The URL carries its own signed expiry; the late consumer rejects it.
      lateStore.consumePresignedDownload(outcome.url),
    ).rejects.toMatchObject({ kind: "permanent", provider: "storage" });
  });

  it("expires downloads only after their declared instant", async () => {
    const store = storage();
    await store.consumePresignedUpload({
      outcome: await store.presignUpload({
        key: "ws_3/payment_proof/proof.jpg",
        contentType: "image/jpeg",
        sizeBytes: 128,
        checksumSha256: CHECKSUM,
      }),
      key: "ws_3/payment_proof/proof.jpg",
      sizeBytes: 128,
      contentType: "image/jpeg",
      checksumSha256: CHECKSUM,
    });
    const download = await store.presignDownload({ key: "ws_3/payment_proof/proof.jpg", expiresInMs: 5 * 60 * 1000 });
    expect(download.expiresAt.getTime()).toBe(BASE.getTime() + 5 * 60 * 1000);
  });
});

describe("FakeObjectStorage — malformed URL handling", () => {
  it("surfaces an unparseable download URL as sanitized malformed_response", async () => {
    const store = storage();
    // `new URL` throws a raw TypeError before any branch could run — the
    // consume helper must translate that into the provider taxonomy
    // instead of leaking the parse failure (cubic PRRT_kwDOT_C_FM6bh9nz).
    await expect(store.consumePresignedDownload("not a url at all")).rejects.toMatchObject({
      kind: "malformed_response",
      provider: "storage",
      operation: "presignDownload",
    });
  });

  it("surfaces an unparseable upload URL as sanitized malformed_response", async () => {
    const store = storage();
    // Same taxonomy on the PUT path: expiry parsing must not explode with
    // a raw TypeError before the provider error mapping runs.
    await expect(
      store.consumePresignedUpload({
        outcome: {
          kind: "success",
          method: "PUT",
          url: "::not a url::",
          expiresAt: new Date(BASE.getTime() + 60_000),
          requiredHeaders: { "content-type": "image/png", "x-amz-checksum-sha256": CHECKSUM },
        },
        key: "ws_1/signature/s1.png",
        sizeBytes: 512,
        contentType: "image/png",
        checksumSha256: CHECKSUM,
      }),
    ).rejects.toMatchObject({
      kind: "malformed_response",
      provider: "storage",
      operation: "presignUpload",
    });
    expect(store.objectCount).toBe(0);
  });

  it("keeps a parseable but unknown-object download URL a permanent error", async () => {
    const store = storage();
    await expect(
      store.consumePresignedDownload("https://fake-storage.internal/download/missing.jpg?expires=99999999999999"),
    ).rejects.toMatchObject({ kind: "permanent", operation: "presignDownload" });
  });
});

describe("FakeObjectStorage — URL identity (exact operation + path)", () => {
  it("does not resolve a download URL for a different key sharing the prefix", async () => {
    const store = storage();
    const outcome = await store.presignUpload({
      key: "ws_1/proof/a.jpg",
      contentType: "image/jpeg",
      sizeBytes: 64,
      checksumSha256: CHECKSUM,
    });
    await store.consumePresignedUpload({
      outcome,
      key: "ws_1/proof/a.jpg",
      sizeBytes: 64,
      contentType: "image/jpeg",
      checksumSha256: CHECKSUM,
    });
    // A download URL minted for `a.jpg` but pointed at a longer sibling
    // path must not resolve to the shorter key (prefix confusion).
    const forged = outcome.url.replace("/upload/", "/download/").replace(
      encodeURIComponent("a.jpg"),
      encodeURIComponent("a.jpg.bak"),
    );
    await expect(store.consumePresignedDownload(forged)).rejects.toMatchObject({
      kind: "permanent",
      operation: "presignDownload",
    });
  });

  it("rejects an upload URL used as a download capability", async () => {
    const store = storage();
    const outcome = await store.presignUpload({
      key: "ws_2/proof/b.jpg",
      contentType: "image/jpeg",
      sizeBytes: 64,
      checksumSha256: CHECKSUM,
    });
    // Same encoded pathname, wrong operation segment.
    await expect(store.consumePresignedDownload(outcome.url)).rejects.toMatchObject({
      kind: "permanent",
      operation: "presignDownload",
    });
  });

  it("rejects an upload whose URL references a different key entirely", async () => {
    const store = storage();
    const outcome = await store.presignUpload({
      key: "ws_3/proof/c.jpg",
      contentType: "image/jpeg",
      sizeBytes: 64,
      checksumSha256: CHECKSUM,
    });
    await expect(
      store.consumePresignedUpload({
        outcome,
        key: "ws_3/proof/other.jpg",
        sizeBytes: 64,
        contentType: "image/jpeg",
        checksumSha256: CHECKSUM,
      }),
    ).rejects.toMatchObject({ kind: "permanent", operation: "presignUpload" });
    expect(store.objectCount).toBe(0);
  });
});

describe("FakeObjectStorage — head/delete of nonexistent keys", () => {
  it("returns not_found for head of a missing object instead of throwing", async () => {
    const store = storage();
    await expect(store.head("ws_x/missing/key")).resolves.toEqual({ kind: "not_found" });
  });

  it("deletes idempotently so orphan cleanup never pre-checks", async () => {
    const store = storage();
    await expect(store.delete("ws_y/never-existed")).resolves.toEqual({ kind: "deleted" });
    const outcome = await store.presignUpload({
      key: "ws_y/orphan/o.jpg",
      contentType: "image/jpeg",
      sizeBytes: 64,
      checksumSha256: CHECKSUM,
    });
    await store.consumePresignedUpload({
      outcome,
      key: "ws_y/orphan/o.jpg",
      sizeBytes: 64,
      contentType: "image/jpeg",
      checksumSha256: CHECKSUM,
    });
    expect(store.objectCount).toBe(1);
    await store.delete("ws_y/orphan/o.jpg");
    expect(store.objectCount).toBe(0);
    await store.delete("ws_y/orphan/o.jpg"); // second delete still resolves
    expect(store.objectCount).toBe(0);
  });
});
