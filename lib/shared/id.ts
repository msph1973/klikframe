import { randomUUID } from "node:crypto";

/**
 * Frozen UUID-generator port. Domain/service code MUST depend on this
 * instead of importing `node:crypto` directly so tests can inject
 * deterministic, sequential identifiers (TESTING.md §2.1).
 */
export interface UuidGenerator {
  next(): string;
}

export class CryptoUuidGenerator implements UuidGenerator {
  next(): string {
    return randomUUID();
  }
}

/** Deterministic test double: produces `<seed>-000000000000`, `-000000000001`, ... */
export class SequentialUuidGenerator implements UuidGenerator {
  private counter = 0;

  constructor(private readonly seed = "00000000-0000-4000-8000") {}

  next(): string {
    const suffix = this.counter.toString(16).padStart(12, "0");
    this.counter += 1;
    return `${this.seed}-${suffix}`;
  }
}
