import { type ExtractTablesWithRelations } from "drizzle-orm";
import type { NeonTransaction } from "drizzle-orm/neon-serverless";

// The frozen vendor-neutral contract (DATABASE_SCHEMA.md §7). This file
// adapts it to Drizzle; the port itself must not change.
import type { TransactionRunner } from "./transaction-port";
import type { Db } from "./client";
import type * as schema from "./schema";

/**
 * Transaction context handed to repository work: a Drizzle
 * `NeonTransaction` (neon-serverless WebSocket driver) bound to the
 * caller's serializable transaction. It is structurally the same query
 * interface the plain `Db` exposes, so callers stay vendor-neutral.
 */
export type DbTx = NeonTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Serializable isolation for every multi-statement business write
 * (DATABASE_SCHEMA.md §7: onboarding and other critical transactions run
 * serializable). Passed through `PgTransactionConfig` so Postgres — not
 * application code — arbitrates concurrent writers; conflicts surface as
 * `40001` and are retried by the runner below.
 */
export const SERIALIZABLE_TX_CONFIG = { isolationLevel: "serializable" } as const;

/** Maximum attempts for a serializable unit of work before giving up. */
export const MAX_SERIALIZABLE_RETRIES = 3;

export class DrizzleTransactionRunner implements TransactionRunner<DbTx> {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Runs `work` inside one serializable transaction. Any thrown error rolls
   * the whole unit back atomically. A Postgres serialization failure
   * (`SQLSTATE 40001`) or lock-not-available (`55P03`) is retried up to
   * `MAX_SERIALIZABLE_RETRIES` times with linear backoff; every other error
   * fails immediately.
   */
  async run<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.#db.transaction(
          async (tx) => work(tx as unknown as DbTx),
          SERIALIZABLE_TX_CONFIG,
        );
      } catch (error) {
        lastError = error;
        if (!isRetryablePostgresError(error) || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
        await delay(attempt);
      }
    }
    throw lastError;
  }
}

// Advisory-lock helpers live in ./advisory-lock (brief file ownership).
export { advisoryLockKey, advisoryLockKeyString, withAdvisoryLock } from "./advisory-lock";

function isRetryablePostgresError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "40001" || code === "40P01" || code === "55P03";
}

function delay(attempt: number): Promise<null> {
  const { promise, resolve } = Promise.withResolvers<null>();
  setTimeout(resolve, attempt * 25);
  return promise;
}
