import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { auditEvents } from "@/lib/db/schema/audit-events";
import { profiles } from "@/lib/db/schema/profiles";
import { workspaceMembers } from "@/lib/db/schema/workspace-members";
import { workspaces } from "@/lib/db/schema/workspaces";
import type { DbTx } from "@/lib/db/transaction-runner";

/** Application-generated UUID primary key (DATABASE_SCHEMA.md header). */
function newId(): string {
  return randomUUID();
}

/**
 * Onboarding persistence (DATABASE_SCHEMA.md §7, API_SPEC.md §9.1). Every
 * function takes the caller's transaction context so profile, workspace,
 * membership, audit event, and idempotency record commit or roll back as
 * one atomic unit. Uniqueness is enforced by the database's partial unique
 * indexes — never by in-memory checks. Slug hand-out is owner-checked:
 * an existing workspace is only ever returned to its authenticated owner.
 */

export interface UpsertProfileInput {
  readonly authUserId: string;
  readonly displayName: string;
  readonly phoneE164: string | null;
  readonly now: Date;
}

/** Insert-or-update keyed by `auth_user_id`; retry keeps one profile row. */
export async function upsertProfile(tx: DbTx, input: UpsertProfileInput): Promise<string> {
  const rows = await tx
    .insert(profiles)
    .values({
      id: newId(),
      authUserId: input.authUserId,
      displayName: input.displayName,
      phoneE164: input.phoneE164,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: profiles.authUserId,
      set: {
        displayName: input.displayName,
        phoneE164: input.phoneE164,
        updatedAt: input.now,
      },
    })
    .returning({ id: profiles.id });
  return requireId(rows[0], "profile");
}

export interface CreateOrLoadWorkspaceInput {
  readonly name: string;
  readonly slug: string;
  readonly now: Date;
}

/**
 * The slug already belongs to a workspace this authenticated identity does
 * not own. Route layer maps this to `409 SLUG_CONFLICT`; it is deliberately
 * NOT the raw unique-violation path, which only fires for concurrent
 * same-identity creation.
 */
export class WorkspaceSlugConflictError extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(`workspace slug ${slug} is already taken by another owner`);
    this.name = "WorkspaceSlugConflictError";
    this.slug = slug;
  }
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  /** True when this call created the row; false for an owned retry load. */
  readonly created: boolean;
}

/**
 * Loads the workspace already owning `slug`, or creates it. The unique slug
 * index makes concurrent creation safe; on conflict the existing row is
 * returned — but ONLY to the authenticated owner of that row. A different
 * identity colliding on a taken slug raises
 * {@link WorkspaceSlugConflictError} instead of receiving the foreign
 * tenant (P0 PRRT_kwDOT_C_FM6bh711): ownership is resolved from
 * `auth_user_id`, never trusted from caller input.
 */
export async function createOrLoadWorkspace(
  tx: DbTx,
  input: CreateOrLoadWorkspaceInput & { readonly authUserId: string },
): Promise<WorkspaceRecord> {
  const inserted = await tx
    .insert(workspaces)
    .values({
      id: newId(),
      name: input.name,
      slug: input.slug,
      status: "active",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning();

  const created = inserted[0];
  if (created !== undefined) {
    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      status: created.status,
      created: true,
    };
  }

  const rows = await tx
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      status: workspaces.status,
    })
    .from(workspaces)
    .where(eq(workspaces.slug, input.slug))
    .limit(1);
  const found = rows[0];
  if (found === undefined) {
    throw new Error(`workspace with slug ${input.slug} vanished mid-transaction`);
  }

  // P0 fix (PRRT_kwDOT_C_FM6bh711): hand the existing tenant out only to
  // its authenticated owner — resolve ownership from workspace_members.
  const owners = await tx
    .select({ authUserId: workspaceMembers.authUserId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, found.id),
        eq(workspaceMembers.role, "owner"),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (owners[0]?.authUserId !== input.authUserId) {
    throw new WorkspaceSlugConflictError(input.slug);
  }

  return { ...found, created: false };
}

export interface MembershipInput {
  readonly workspaceId: string;
  readonly authUserId: string;
  readonly now: Date;
}

/**
 * Loads the active owner membership when one already exists for this
 * identity + workspace (idempotent retry after a first commit), otherwise
 * inserts it fresh. Callers must have serialized same-identity onboarding
 * via {@link withAdvisoryLock}; the partial unique indexes still reject any
 * second active owner at the database level.
 */
export async function createActiveOwnerMembership(
  tx: DbTx,
  input: MembershipInput,
): Promise<string> {
  const existing = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.authUserId, input.authUserId),
        eq(workspaceMembers.role, "owner"),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (existing[0] !== undefined) {
    return existing[0].id;
  }

  const rows = await tx
    .insert(workspaceMembers)
    .values({
      id: newId(),
      workspaceId: input.workspaceId,
      authUserId: input.authUserId,
      role: "owner",
      status: "active",
      joinedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: workspaceMembers.id });
  return requireId(rows[0], "membership");
}

export interface AppendAuditEventInput {
  readonly workspaceId: string;
  readonly actorType: "owner" | "portal" | "system";
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly now: Date;
}

/** Append-only audit write (SECURITY.md §8.1). */
export async function appendAuditEvent(tx: DbTx, input: AppendAuditEventInput): Promise<string> {
  const rows = await tx
    .insert(auditEvents)
    .values({
      id: newId(),
      workspaceId: input.workspaceId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      metadata: input.metadata ?? null,
      createdAt: input.now,
    })
    .returning({ id: auditEvents.id });
  return requireId(rows[0], "audit event");
}

export function requireId(row: { id: string } | undefined, label: string): string {
  if (row === undefined) {
    throw new Error(`${label} insert returned no row`);
  }
  return row.id;
}
