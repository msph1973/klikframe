import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { workspaceStatusEnum } from "./enums";

/**
 * `workspaces` (DATABASE_SCHEMA.md §2) — the tenant boundary. Every business
 * table carries `workspace_id`; child tables expose the canonical
 * `(workspace_id, id)` unique set so future composite foreign keys can bind
 * a relation to exactly one business account (§6 FK inventory). On
 * `workspaces` itself no extra key is needed: the primary key already
 * guarantees uniqueness on `id`, and Postgres FKs must match an existing
 * unique constraint's exact column set, so an `UNIQUE(id)` restatement could
 * never back a composite target anyway.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    bankAccount: jsonb("bank_account").$type<Record<string, unknown> | null>(),
    status: workspaceStatusEnum("status").notNull().default("active"),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("workspaces_status_idx").on(table.status)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
