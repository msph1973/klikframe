import { index, jsonb, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { workspaceStatusEnum } from "./enums";

/**
 * `workspaces` (DATABASE_SCHEMA.md §2) — the tenant boundary. Every business
 * table carries `workspace_id`; the composite `(workspace_id, id)` key below
 * is what all cross-table composite foreign keys point at (§6 FK inventory).
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
  (table) => [
    // §6: every tenant table carries UNIQUE (workspace_id, id) so child FKs
    // can bind a relation to exactly one business account. On `workspaces`
    // itself the tenant column IS the row, so this restates UNIQUE(id) under
    // the canonical constraint name that child composite keys reference.
    unique("workspaces_workspace_id_id_key").on(table.id),
    index("workspaces_status_idx").on(table.status),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
