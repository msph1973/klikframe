import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Canonical status enums (DATABASE_SCHEMA.md §2, §6 State Transition Matrix).
 * Values MUST match the canonical docs exactly — `docs:check` and the unit
 * schema-shape tests both assert this vocabulary.
 */

/** Lifecycle of the business account (`workspaces.status`). */
export const workspaceStatusEnum = pgEnum("workspace_status", [
  "active",
  "deletion_pending",
  "suspended",
  "deleted",
]);

/** Membership lifecycle (DATABASE_SCHEMA.md §6): `revoked` is terminal. */
export const memberStatusEnum = pgEnum("member_status", ["active", "suspended", "revoked"]);

/** MVP role vocabulary is owner-only; admin/assistant are Post-MVP migrations. */
export const memberRoleEnum = pgEnum("member_role", ["owner"]);

/** Audit actor taxonomy (DATABASE_SCHEMA.md §5 audit_events). */
export const actorTypeEnum = pgEnum("actor_type", ["owner", "portal", "system"]);
