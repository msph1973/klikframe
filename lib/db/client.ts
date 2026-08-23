import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import "server-only";

import { getEnv, resetEnvCacheForTests } from "@/lib/config/env";

import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;

let cachedDb: Db | undefined;

/**
 * Singleton Drizzle client over the Neon serverless driver
 * (ARCHITECTURE.md §3.3). Reads the canonical `DATABASE_URL` through the
 * frozen env parser — never `process.env` directly.
 *
 * Driver choice: `drizzle-orm/neon-serverless` wraps `@neondatabase/
 * serverless`'s WebSocket `Pool`, which supports interactive transactions
 * (`BEGIN … COMMIT`) and advisory locks. The HTTP driver
 * (`drizzle-orm/neon-http`) rejects both — its `transaction()` throws
 * unconditionally — so it cannot back `DrizzleTransactionRunner`.
 */
export function getDb(): Db {
  if (cachedDb === undefined) {
    const { DATABASE_URL } = getEnv();
    if (DATABASE_URL === undefined) {
      throw new Error("DATABASE_URL is required to construct the database client");
    }
    cachedDb = drizzle(DATABASE_URL, { schema });
  }
  return cachedDb;
}

/**
 * Test-only: drops the memoized client AND the environment cache so a
 * changed `process.env.DATABASE_URL` actually takes effect — `getEnv()`
 * memoizes independently, so clearing only the client would silently keep
 * serving the old URL (PRRT_kwDOT_C_FM6bh72R).
 */
export function resetDbClientForTests(): void {
  cachedDb = undefined;
  resetEnvCacheForTests();
}
