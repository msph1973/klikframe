import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * `profiles` (DATABASE_SCHEMA.md §2). One application profile per Neon Auth
 * identity. There is deliberately NO physical FK to the managed
 * `neon_auth.user` schema — onboarding verifies identity through the auth
 * adapter and a reconciliation job audits orphaned references.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  authUserId: text("auth_user_id").notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  phoneE164: varchar("phone_e164", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
