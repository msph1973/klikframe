import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { actorTypeEnum } from "./enums";
import { workspaces } from "./workspaces";

/**
 * `audit_events` (DATABASE_SCHEMA.md §5). Append-only at the database
 * boundary: a BEFORE UPDATE OR DELETE trigger
 * (`audit_events_append_only` → `audit_events_block_mutation`, created in
 * the checked-in migration) rejects any mutation with an exception, so the
 * enforcement does not depend on role/grant hygiene. Corrections are
 * compensating events. Metadata is an allowlisted JSON object — never
 * secrets, raw tokens, or raw PII (SECURITY.md §8.1).
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
  (table) => [
    // §6 composite tenant key: child FKs bind a relation to exactly one
    // business account, so every tenant table must expose the canonical
    // UNIQUE (workspace_id, id) target set (PRRT_kwDOT_C_FM6bh72G).
    unique("audit_events_workspace_id_id_key").on(table.workspaceId, table.id),
    index("audit_events_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
