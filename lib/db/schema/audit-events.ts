import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { actorTypeEnum } from "./enums";
import { workspaces } from "./workspaces";

/**
 * `audit_events` (DATABASE_SCHEMA.md §5). Append-only: the application role
 * never receives UPDATE/DELETE on these rows; corrections are compensating
 * events. Metadata is an allowlisted JSON object — never secrets, raw
 * tokens, or raw PII (SECURITY.md §8.1).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    // Auth user ID, portal token ID, or cron identity.
    actorId: text("actor_id").notNull(),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("audit_events_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
