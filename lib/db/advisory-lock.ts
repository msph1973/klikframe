import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DbTx } from "./transaction-runner";

/**
 * Advisory-lock helper keyed by `auth_user_id` (DATABASE_SCHEMA.md §7:
 * "satu transaksi serializable/advisory-lock per auth_user_id"). Serializes
 * concurrent onboardings of the same identity across nodes before any row
 * is written, complementing the unique partial indexes that remain the
 * final database-level correctness boundary.
 */
export async function withAdvisoryLock<T>(
  tx: DbTx,
  authUserId: string,
  work: () => Promise<T>,
): Promise<T> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${advisoryLockKey(authUserId)})`);
  return work();
}

/** Deterministic signed int8 key from a SHA-256 hash of the identity. */
export function advisoryLockKey(authUserId: string): bigint {
  const digest = createHash("sha256").update(`klikframe:auth_user:${authUserId}`).digest();
  // Reinterpret the 64-bit big-endian digest prefix as two's complement so
  // the value always fits PostgreSQL's signed int8 range accepted by the
  // pg_advisory_* functions (verified against a live PostgreSQL instance).
  return BigInt.asIntN(64, digest.readBigUInt64BE());
}
