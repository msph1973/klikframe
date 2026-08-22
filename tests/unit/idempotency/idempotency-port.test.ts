import { describe, expect, it } from "vitest";
import { computeCanonicalBodyHash } from "../../../lib/idempotency/idempotency-port";

describe("computeCanonicalBodyHash", () => {
  it("produces a stable 64-character hex sha256 digest", () => {
    const hash = computeCanonicalBodyHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of object key order", () => {
    const a = computeCanonicalBodyHash({ business_name: "Klik Studio", slug: "klik-studio" });
    const b = computeCanonicalBodyHash({ slug: "klik-studio", business_name: "Klik Studio" });
    expect(a).toBe(b);
  });

  it("is independent of nested object key order", () => {
    const a = computeCanonicalBodyHash({ owner: { name: "Ayu", phone: "+628123456789" } });
    const b = computeCanonicalBodyHash({ owner: { phone: "+628123456789", name: "Ayu" } });
    expect(a).toBe(b);
  });

  it("preserves array order as significant", () => {
    const a = computeCanonicalBodyHash({ items: [1, 2] });
    const b = computeCanonicalBodyHash({ items: [2, 1] });
    expect(a).not.toBe(b);
  });

  it("distinguishes different values", () => {
    const a = computeCanonicalBodyHash({ slug: "klik-studio" });
    const b = computeCanonicalBodyHash({ slug: "klik-studio-2" });
    expect(a).not.toBe(b);
  });

  it("distinguishes a key moved between nesting levels", () => {
    const a = computeCanonicalBodyHash({ a: { b: 1 } });
    const b = computeCanonicalBodyHash({ b: 1 });
    expect(a).not.toBe(b);
  });

  it("sorts keys by code-point order, not locale collation", () => {
    // "B" (0x42) sorts before "a" (0x61) in code-point order but after it
    // under many locale collations; the hash must not depend on which.
    const a = computeCanonicalBodyHash({ B: 1, a: 2 });
    const b = computeCanonicalBodyHash({ a: 2, B: 1 });
    expect(a).toBe(b);
  });

  it("never throws on an undefined body or property value", () => {
    expect(() => computeCanonicalBodyHash(undefined)).not.toThrow();
    expect(() => computeCanonicalBodyHash({ a: undefined })).not.toThrow();
  });
});
