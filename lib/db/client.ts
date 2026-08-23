import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import "server-only";

import { getEnv } from "@/lib/config/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * The transaction context handed to `TransactionRunner` work. It is the
 * Drizzle database handle itself: repositories receive a typed query
 * interface and never see vendor connection objects.
 */
export type DbTx = Db;

let cachedDb: Db | undefined;

/**
 * Singleton Drizzle client over the Neon serverless driver
 * (ARCHITECTURE.md §3.3). Reads the canonical `DATABASE_URL` through the
 * frozen env parser — never `process.env` directly.
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

/** Test-only: drops the memoized client so a new env takes effect. */
export function resetDbClientForTests(): void {
  cachedDb = undefined;
}
