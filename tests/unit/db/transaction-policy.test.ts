import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  advisoryLockKey,
  advisoryLockKeyString,
  withAdvisoryLock,
} from "../../../lib/db/advisory-lock";
import {
  MAX_SERIALIZABLE_RETRIES,
  SERIALIZABLE_TX_CONFIG,
  type DbTx,
} from "../../../lib/db/transaction-runner";

/**
 * Pure data-layer primitives (DATABASE_SCHEMA.md §7): advisory-lock key
 * math and the serializable transaction policy constants. The PostgreSQL-
 * bound behavior around them is covered by tests/integration.
 */
describe("advisory lock helper", () => {
  it("derives a deterministic key per identity", () => {
    expect(advisoryLockKey("auth-42")).toBe(advisoryLockKey("auth-42"));
    expect(advisoryLockKey("auth-43")).not.toBe(advisoryLockKey("auth-42"));
  });

  it("keeps every derived key inside PostgreSQL signed int8 range", () => {
    for (let i = 0; i < 500; i += 1) {
      const key = advisoryLockKey(`auth-${String(i)}`);
      expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
      expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    }
  });

  it("exposes a JSON-safe decimal string form of the key", () => {
    // Regression for PRRT_kwDOT_C_FM6bh71-: native bigint cannot cross the
    // Neon drivers' JSON serialization; the wire form must be a string.
    const key = advisoryLockKey("auth-42");
    const asString = advisoryLockKeyString("auth-42");
    expect(typeof asString).toBe("string");
    expect(BigInt(asString)).toBe(key);
    expect(() => JSON.stringify({ key: asString })).not.toThrow();
  });

  it("configures serializable transactions with a retry budget", () => {
    expect(SERIALIZABLE_TX_CONFIG).toEqual({ isolationLevel: "serializable" });
    expect(MAX_SERIALIZABLE_RETRIES).toBeGreaterThan(0);
  });
});

interface RecordingDb {
  readonly tx: DbTx;
  readonly statements: SQL[];
}

/** Captures every executed statement for wire-format inspection. */
function makeRecordingDb(): RecordingDb {
  const statements: SQL[] = [];
  const tx = {
    execute: (query: SQL) => {
      statements.push(query);
      return Promise.resolve({ rows: [] });
    },
  };
  return { tx: tx as unknown as DbTx, statements };
}

describe("withAdvisoryLock", () => {
  it("locks with an int8-cast decimal string, then runs the work", async () => {
    const recording = makeRecordingDb();
    const marker = Symbol("done");

    const result = await withAdvisoryLock(recording.tx, "auth-42", () => Promise.resolve(marker));

    expect(result).toBe(marker);
    expect(recording.statements).toHaveLength(1);

    // Render the statement exactly as the driver would bind it: the key
    // must arrive as a decimal string bound to an `::int8` cast — never a
    // raw bigint, which has no JSON form over the Neon drivers
    // (PRRT_kwDOT_C_FM6bh71-).
    const statement = recording.statements[0];
    expect(statement).toBeDefined();
    if (statement === undefined) return;
    const rendered = new PgDialect().sqlToQuery(statement);
    expect(rendered.params).toEqual([advisoryLockKeyString("auth-42")]);
    expect(rendered.sql).toBe("SELECT pg_advisory_xact_lock($1::int8)");
  });

  it("runs the work only after the lock statement resolves", async () => {
    const order: string[] = [];
    const tx = {
      execute: (query: SQL) => {
        order.push(`lock:${new PgDialect().sqlToQuery(query).sql}`);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as DbTx;
    const result = await withAdvisoryLock(tx, "auth-43", () => {
      order.push("work");
      return Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(order).toEqual([
      "lock:SELECT pg_advisory_xact_lock($1::int8)",
      "work",
    ]);
  });
});
