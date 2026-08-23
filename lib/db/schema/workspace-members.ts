import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { memberRoleEnum, memberStatusEnum } from "./enums";
import { workspaces } from "./workspaces";

/**
 * `workspace_members` (DATABASE_SCHEMA.md §2). The two partial unique
 * indexes below are THE onboarding concurrency boundary (§7): they make the
 * database — not an in-memory mutex — guarantee AT MOST one active owner
 * per workspace and at most one owned workspace per identity. Uniqueness
 * bounds cardinality only; a workspace with no active owner row remains
 * possible (existence is an application-level invariant), and the
 * single-active-owner-per-workspace index is what makes concurrent
 * onboarding races resolve to exactly one winner.
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    authUserId: text("auth_user_id").notNull(),
    role: memberRoleEnum("role").notNull().default("owner"),
    status: memberStatusEnum("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("workspace_members_workspace_id_auth_user_id_key").on(
      table.workspaceId,
      table.authUserId,
    ),
    // One active owner per workspace.
    uniqueIndex("workspace_members_single_active_owner_per_workspace_key")
      .on(table.workspaceId)
      .where(sql`role = 'owner' AND status = 'active'`),
    // At most one owned workspace per identity.
    uniqueIndex("workspace_members_single_owned_workspace_per_identity_key")
      .on(table.authUserId)
      .where(sql`role = 'owner' AND status = 'active'`),
    index("workspace_members_auth_user_id_status_idx").on(table.authUserId, table.status),
  ],
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
