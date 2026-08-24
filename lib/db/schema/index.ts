export { actorTypeEnum, memberRoleEnum, memberStatusEnum, workspaceStatusEnum } from "./enums";
export { profiles } from "./profiles";
export { workspaces } from "./workspaces";
export { workspaceMembers } from "./workspace-members";
export { auditEvents } from "./audit-events";
export { idempotencyRequests } from "./idempotency-requests";

export type { NewProfile, Profile } from "./profiles";
export type { NewWorkspace, Workspace } from "./workspaces";
export type { NewWorkspaceMember, WorkspaceMember } from "./workspace-members";
export type { AuditEvent, NewAuditEvent } from "./audit-events";
export type { IdempotencyRequest, NewIdempotencyRequest } from "./idempotency-requests";

import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Declared ONLY so drizzle-kit introspection knows the managed `neon_auth`
 * schema exists and must never be mutated by application migrations
 * (DATABASE_SCHEMA.md §1). No KlikFrame table is defined inside it.
 */
export const neonAuthManagedSchema = pgSchema("neon_auth");
