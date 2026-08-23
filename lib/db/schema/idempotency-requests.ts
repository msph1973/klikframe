import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { workspaces } from "./workspaces";

/**
 * `idempotency_requests` — persisted replay store backing the frozen
 * `IdempotencyStore` port (API_SPEC.md §1.4; plan Step 2). A key is scoped
 * by principal + route + resource for at least 24h: same scope + body hash
 * replays the original response, same scope + different body is a 409
 * IDEMPOTENCY_CONFLICT. The scope unique is `NULLS NOT DISTINCT` so NULL
 * `resource_id` rows (onboarding, pre-workspace) still collide. Rows are
 * tenant-tagged with `workspace_id` (nullable because onboarding runs
 * pre-workspace) and carry the §6 composite unique `(workspace_id, id)` so
 * future rows can be FK targets.
 */
export const idempotencyRequests = pgTable(
  "idempotency_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    // principalId + route + resourceId + key are stored as plain columns;
    // their combination is the uniqueness scope below.
    principalId: text("principal_id").notNull(),
    route: varchar("route", { length: 255 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }),
    key: varchar("key", { length: 255 }).notNull(),
    requestBodyHash: varchar("request_body_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // NULLS NOT DISTINCT: PostgreSQL otherwise treats each NULL resource_id
    // (onboarding runs pre-workspace) as distinct, letting repeated
    // same-scope requests insert multiple rows and defeating replay/conflict
    // detection at the database boundary (PRRT_kwDOT_C_FM6bh715).
    unique("idempotency_requests_scope_key")
      .on(table.principalId, table.route, table.resourceId, table.key)
      .nullsNotDistinct(),
    // §6 composite tenant key (workspace_id may be NULL pre-workspace).
    unique("idempotency_requests_workspace_id_id_key").on(table.workspaceId, table.id),
    index("idempotency_requests_expires_at_idx").on(table.expiresAt),
    // Frozen replay contract (API_SPEC.md §1.4): a record must stay live
    // for its full 24h window, never expire before it is created
    // (PRRT_kwDOT_C_FM6bh72I).
    check(
      "idempotency_requests_expiry_after_creation_check",
      sql`${table.expiresAt} >= ${table.createdAt} + interval '24 hours'`,
    ),
  ],
);

export type IdempotencyRequest = typeof idempotencyRequests.$inferSelect;
export type NewIdempotencyRequest = typeof idempotencyRequests.$inferInsert;
