import { describe, expect, it } from "vitest";
import { CryptoUuidGenerator, SequentialUuidGenerator } from "../../../lib/shared/id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("CryptoUuidGenerator", () => {
  it("produces well-formed, unique UUIDs", () => {
    const generator = new CryptoUuidGenerator();
    const first = generator.next();
    const second = generator.next();
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });
});

describe("SequentialUuidGenerator", () => {
  it("produces deterministic, incrementing identifiers from a seed", () => {
    const generator = new SequentialUuidGenerator();
    expect(generator.next()).toBe("00000000-0000-4000-8000-000000000000");
    expect(generator.next()).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("is independent per instance", () => {
    const a = new SequentialUuidGenerator();
    const b = new SequentialUuidGenerator();
    a.next();
    expect(b.next()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
