import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

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
 * indexes — never by in-memory checks.
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
 * Loads the workspace already owning `slug`, or creates it. The unique slug
 * index makes concurrent creation safe; on conflict the existing row is
 * returned (§7: retry returns the same workspace).
 */
export async function createOrLoadWorkspace(
  tx: DbTx,
  input: CreateOrLoadWorkspaceInput,
): Promise<{ id: string; name: string; slug: string; status: string }> {
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
    };
  }

  const existing = await tx
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, input.slug))
    .limit(1);
  const found = existing[0];
  if (found === undefined) {
    throw new Error(`workspace with slug ${input.slug} vanished mid-transaction`);
  }
  return { id: found.id, name: found.name, slug: found.slug, status: found.status };
}

export interface MembershipInput {
  readonly workspaceId: string;
  readonly authUserId: string;
  readonly now: Date;
}

/**
 * Creates the active owner membership for a fresh workspace. Callers must
 * have serialized same-identity onboarding via {@link withAdvisoryLock};
 * the partial unique indexes still reject any second active owner at the
 * database level.
 */
export async function createActiveOwnerMembership(
  tx: DbTx,
  input: MembershipInput,
): Promise<string> {
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
