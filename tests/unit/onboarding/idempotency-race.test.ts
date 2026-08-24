import { describe, expect, it } from "vitest";

import {
  IdempotencyRaceError,
  pgSqlState,
} from "../../../lib/onboarding/onboard-owner";

/**
 * Unit coverage for the idempotency insert race (PRRT_kwDOT_C_FM6bpjbA):
 * a concurrent duplicate insert surfaces SQLSTATE 23505 wrapped by Drizzle's
 * `DrizzleQueryError`; the repository layer classifies it and aborts with
 * {@link IdempotencyRaceError} — never the raw violation as a generic 500.
 * The route layer retries once in a fresh transaction whose new snapshot
 * observes the winner's committed row through the replay lookup. The real
 * PostgreSQL-level race is covered by tests/integration; these tests pin
 * the classification contract.
 */
describe("pgSqlState", () => {
  it("reads the SQLSTATE off a plain driver error", () => {
    const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    expect(pgSqlState(error)).toBe("23505");
  });

  it("unwraps DrizzleQueryError cause chains", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });
    const wrapped = new Error("query failed at drizzle layer", { cause });
    expect(pgSqlState(wrapped)).toBe("23505");
  });

  it("returns undefined for errors without a code anywhere on the chain", () => {
    expect(pgSqlState(new Error("no sqlstate"))).toBeUndefined();
    expect(pgSqlState(undefined)).toBeUndefined();
    expect(pgSqlState("23505")).toBeUndefined();
  });
});

describe("IdempotencyRaceError contract", () => {
  it("exposes a stable name for downstream instanceof checks", () => {
    const error = new IdempotencyRaceError();
    expect(error.name).toBe("IdempotencyRaceError");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("concurrent");
  });
});
