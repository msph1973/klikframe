import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe } from "vitest";
import { Pool } from "pg";

import * as schema from "../../../lib/db/schema";

/**
 * Integration harness bootstrap (tests/integration/README.md). Activates
 * only when CI provides `TEST_DATABASE_URL`; otherwise every suite using
 * `describeIntegration` is skipped and the gate stays green.
 */
export const TEST_DATABASE_URL: string | undefined = process.env.TEST_DATABASE_URL;

export function describeIntegration(name: string, fn: () => void): void {
  if (TEST_DATABASE_URL === undefined || TEST_DATABASE_URL.length === 0) {
    describe.skip(name, fn);
  } else {
    describe(name, fn);
  }
}

/** Concrete harness contract owned here so scenarios import the name. */
export interface HarnessDb {
  readonly db: NodePgDatabase<typeof schema>;
  readonly pool: Pool;
}

export function createHarnessDb(): HarnessDb {
  if (TEST_DATABASE_URL === undefined || TEST_DATABASE_URL.length === 0) {
    throw new Error("createHarnessDb requires TEST_DATABASE_URL (CI harness only)");
  }
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  // Schema-bound so `db.transaction()` yields a PgTransaction typed over the
  // full schema — structurally assignable to the app's DbTx (neon-serverless
  // transaction) for repository call sites.
  return { db: drizzle(pool, { schema }), pool };
}

export async function closeHarnessDb(harness: HarnessDb): Promise<void> {
  await harness.pool.end();
}

export interface TableCounts {
  readonly profiles: number;
  readonly workspaces: number;
  readonly workspaceMembers: number;
  readonly auditEvents: number;
  readonly idempotencyRequests: number;
}

/** Row counts used by rollback/concurrency assertions across all tables. */
export async function readTableCounts(db: NodePgDatabase<typeof schema>): Promise<TableCounts> {
  const result = await db.execute<{
    profiles: number;
    workspaces: number;
    workspace_members: number;
    audit_events: number;
    idempotency_requests: number;
  }>(sql`SELECT
      (SELECT count(*)::int FROM profiles) AS profiles,
      (SELECT count(*)::int FROM workspaces) AS workspaces,
      (SELECT count(*)::int FROM workspace_members) AS workspace_members,
      (SELECT count(*)::int FROM audit_events) AS audit_events,
      (SELECT count(*)::int FROM idempotency_requests) AS idempotency_requests`);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("count query returned no rows");
  }
  return {
    profiles: row.profiles,
    workspaces: row.workspaces,
    workspaceMembers: row.workspace_members,
    auditEvents: row.audit_events,
    idempotencyRequests: row.idempotency_requests,
  };
}
