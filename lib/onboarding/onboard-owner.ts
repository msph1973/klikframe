import { randomUUID } from "node:crypto";

import { withAdvisoryLock } from "@/lib/db/advisory-lock";
import type { DbTx } from "@/lib/db/transaction-runner";

import { idempotencyRequests } from "@/lib/db/schema/idempotency-requests";
import {
  appendAuditEvent,
  createActiveOwnerMembership,
  createOrLoadWorkspace,
  requireId,
  upsertProfile,
  type AppendAuditEventInput,
  type CreateOrLoadWorkspaceInput,
  type UpsertProfileInput,
} from "./repository";

export * from "./repository";

export interface IdempotencyRecordInput {
  readonly workspaceId: string | null;
  readonly principalId: string;
  readonly route: string;
  readonly resourceId: string | null;
  readonly key: string;
  readonly requestBodyHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface OnboardingTransactionInput {
  readonly profile: UpsertProfileInput;
  readonly workspace: CreateOrLoadWorkspaceInput;
  readonly audit: Pick<AppendAuditEventInput, "requestId"> & {
    readonly metadata?: Record<string, unknown>;
  };
  readonly idempotency?: IdempotencyRecordInput;
}

export interface OnboardingResult {
  readonly profileId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceStatus: string;
  readonly membershipId: string;
  readonly auditEventId: string;
  /** Set when an idempotency record was persisted in the same transaction. */
  readonly idempotencyRequestId: string | null;
}

/**
 * Atomic owner onboarding (DATABASE_SCHEMA.md §7, KF-ONB-001). Runs the
 * full write set — advisory lock, profile upsert, create-or-load workspace,
 * active owner membership, audit event, and optional idempotency record —
 * inside ONE caller-provided serializable transaction. Any failure rolls
 * back every step; a retry returns the same workspace (unique constraints),
 * never a second business account.
 *
 * The advisory lock keyed by `auth_user_id` serializes same-identity
 * concurrent onboardings before any write; the unique partial indexes on
 * `workspace_members` remain the final database-level correctness boundary.
 */
export async function runOnboardingTransaction(
  tx: DbTx,
  input: OnboardingTransactionInput,
): Promise<OnboardingResult> {
  return withAdvisoryLock(tx, input.profile.authUserId, async () => {
    const profileId = await upsertProfile(tx, input.profile);
    const workspace = await createOrLoadWorkspace(tx, input.workspace);
    const membershipId = await createActiveOwnerMembership(tx, {
      workspaceId: workspace.id,
      authUserId: input.profile.authUserId,
      now: input.workspace.now,
    });
    const auditId = await appendAuditEvent(tx, {
      workspaceId: workspace.id,
      actorType: "owner",
      actorId: input.profile.authUserId,
      action: "workspace.onboarded",
      resourceType: "workspace",
      resourceId: workspace.id,
      requestId: input.audit.requestId,
      metadata: input.audit.metadata,
      now: input.workspace.now,
    });
    let idempotencyRequestId: string | null = null;
    if (input.idempotency !== undefined) {
      idempotencyRequestId = await recordIdempotencyRequest(tx, input.idempotency);
    }
    return {
      profileId,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceStatus: workspace.status,
      membershipId,
      auditEventId: auditId,
      idempotencyRequestId,
    };
  });
}

/**
 * Persists one replay record inside the onboarding transaction
 * (API_SPEC.md §1.4). The scope unique index makes a concurrent duplicate
 * insert fail the whole transaction rather than silently double-store.
 */
async function recordIdempotencyRequest(
  tx: DbTx,
  input: IdempotencyRecordInput,
): Promise<string> {
  const rows = await tx
    .insert(idempotencyRequests)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      route: input.route,
      resourceId: input.resourceId,
      key: input.key,
      requestBodyHash: input.requestBodyHash,
      responseStatus: input.responseStatus,
      responseBody: ensureJsonRecord(input.responseBody),
      expiresAt: input.expiresAt,
      createdAt: input.now,
    })
    .returning({ id: idempotencyRequests.id });
  return requireId(rows[0], "idempotency request");
}

/** JSONB columns accept objects; non-object bodies are wrapped verbatim. */
function ensureJsonRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return { body };
}
