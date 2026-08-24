import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { workspaceStatusEnum } from "./enums";

/**
 * `workspaces` (DATABASE_SCHEMA.md §2) — the tenant boundary. Every business
 * table carries `workspace_id`; child tables expose the canonical
 * `(workspace_id, id)` unique set so future composite foreign keys can bind
 * a relation to exactly one business account (§6 FK inventory).
 *
 * §6's composite-key rule applies to tenant-scoped tables (those carrying a
 * `workspace_id` column). `workspaces` is the tenant root: its
 * `(workspace_id, id)` pair degenerates to `UNIQUE(id)`, which is redundant
 * with the PK and can never back a composite child FK's two-column target
 * list — so no extra key is declared here. Child tables instead reference
 * `workspaces(id)` for the tenant half of their composite keys.
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
  // No `(workspace_id, id)` key here: on the tenant root itself that pair
  // degenerates to (id, id) — i.e. UNIQUE(id) — which is fully redundant with
  // the PK and can never back a composite child FK's two-column target list.
  (table) => [index("workspaces_status_idx").on(table.status)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
