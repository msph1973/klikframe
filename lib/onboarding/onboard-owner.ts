import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { withAdvisoryLock } from "@/lib/db/advisory-lock";
import type { DbTx } from "@/lib/db/transaction-runner";
import type { TransactionRunner } from "@/lib/db/transaction-port";
import { AppError } from "@/lib/http/errors";
import { idempotencyRequests } from "@/lib/db/schema/idempotency-requests";
import { workspaceMembers } from "@/lib/db/schema/workspace-members";
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

export interface IdempotencyReplay {
  readonly requestBodyHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/**
 * Looks up an existing committed idempotency record for this scope+key.
 * Returns null when no record exists (first-time request).
 */
export async function findIdempotencyRecord(
  tx: DbTx,
  scope: { principalId: string; route: string; key: string },
): Promise<IdempotencyReplay | null> {
  const rows = await tx
    .select({
      requestBodyHash: idempotencyRequests.requestBodyHash,
      responseStatus: idempotencyRequests.responseStatus,
      responseBody: idempotencyRequests.responseBody,
    })
    .from(idempotencyRequests)
    .where(
      and(
        eq(idempotencyRequests.principalId, scope.principalId),
        eq(idempotencyRequests.route, scope.route),
        eq(idempotencyRequests.key, scope.key),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { responseStatus: row.responseStatus, responseBody: row.responseBody, requestBodyHash: row.requestBodyHash };
}

/** SQLSTATE of a Postgres unique-constraint violation. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

/**
 * Extracts the raw SQLSTATE from a Drizzle failure. Drizzle wraps driver
 * errors in `DrizzleQueryError`, so the code may sit on the error itself or
 * anywhere along its `cause` chain (the same shape the integration harness
 * unwraps in its `pgCode()` helper).
 */
export function pgSqlState(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (
    let depth = 0;
    depth < 5 && typeof candidate === "object" && candidate !== null;
    depth += 1
  ) {
    const maybeCode: unknown = "code" in candidate ? candidate.code : undefined;
    if (typeof maybeCode === "string") {
      return maybeCode;
    }
    const maybeCause: unknown = "cause" in candidate ? candidate.cause : undefined;
    candidate = maybeCause;
  }
  return undefined;
}

/**
 * Precondition for POST /onboarding (API_SPEC.md §2 "owner session tanpa
 * workspace"): an identity that already holds an active owner membership is
 * `ALREADY_ONBOARDED`, whatever slug it now presents. The route calls this
 * BEFORE opening the onboarding transaction so the rejection never touches
 * the requested slug and cannot degrade into the membership unique-index
 * violation's generic 500 (PRRT_kwDOT_C_FM6bpRIt). A valid replay still
 * short-circuits earlier via its committed idempotency record.
 *
 * Runs as its own tiny serializable transaction: a single consistent SELECT,
 * no writes, nothing to retry beyond what {@link DrizzleTransactionRunner}
 * already covers. Concurrent first-time onboardings are unaffected — the
 * membership row does not exist yet, both racers pass, and the advisory lock
 * plus partial unique indexes inside the real transaction remain the
 * correctness boundary.
 */
export async function assertNotAlreadyOnboarded(
  runner: TransactionRunner<DbTx>,
  authUserId: string,
): Promise<void> {
  await runner.run(async (tx) => {
    const rows = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.authUserId, authUserId),
          eq(workspaceMembers.role, "owner"),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .limit(1);
    if (rows[0] !== undefined) {
      throw new AppError("ALREADY_ONBOARDED", "Identity already owns a workspace");
    }
  });
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
    const workspace = await createOrLoadWorkspace(tx, {
      ...input.workspace,
      authUserId: input.profile.authUserId,
    });
    const membershipId = await createActiveOwnerMembership(tx, {
      workspaceId: workspace.id,
      authUserId: input.profile.authUserId,
      now: input.workspace.now,
      // Fresh-onboarding path (PRRT_kwDOT_C_FM6biuYn follow-up): when this
      // transaction just created the workspace, the retry pre-SELECT cannot
      // match a committed membership and is skipped.
      skipExistingLookup: workspace.created,
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
 *
 * Two identical requests can both observe "no committed record" before
 * either acquires the advisory lock, so the loser reaches this insert and
 * hits the scope unique with SQLSTATE 23505. That race must surface as a
 * replay of the winner's response — never as a generic 500
 * (PRRT_kwDOT_C_FM6bpjbA). Under serializable isolation an in-transaction
 * re-query CANNOT observe the winner (its commit is invisible to this
 * aborted snapshot), so this classifies the violation and aborts via
 * {@link IdempotencyRaceError}; the route layer then retries the whole use
 * case once — the fresh transaction's snapshot sees the winner's committed
 * row and replays it (or conflicts on a body-hash mismatch). A 23505 on any
 * other constraint still rethrows: that is a genuine defect, not a race.
 */
async function recordIdempotencyRequest(
  tx: DbTx,
  input: IdempotencyRecordInput,
): Promise<string> {
  try {
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
  } catch (error) {
    if (pgSqlState(error) !== UNIQUE_VIOLATION_SQLSTATE) {
      throw error;
    }
    throw new IdempotencyRaceError();
  }
}

/**
 * Signals that THIS transaction lost the idempotency-scope unique race:
 * a concurrent request inserted the same (principal, route, resource, key)
 * row first and committed. The transaction is aborted; callers must retry
 * in a FRESH transaction whose snapshot can observe the winner's record.
 */
export class IdempotencyRaceError extends Error {
  constructor() {
    super("idempotency record was stored by a concurrent request");
    this.name = "IdempotencyRaceError";
  }
}

/**
 * Updates the stored idempotency response body in-place (same transaction)
 * once the real IDs exist, so a replay returns the exact body the original
 * client received — not the empty placeholder.
 */
export async function updateIdempotencyResponseBody(
  tx: DbTx,
  scope: {
    workspaceId: string | null;
    principalId: string;
    route: string;
    key: string;
    resourceId: string | null;
  },
  responseBody: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(idempotencyRequests)
    .set({ responseBody })
    .where(
      and(
        eq(idempotencyRequests.principalId, scope.principalId),
        eq(idempotencyRequests.route, scope.route),
        eq(idempotencyRequests.key, scope.key),
        // Null-aware completion scope (PRRT_kwDOT_C_FM6bqJ-s): without a
        // resource_id predicate this update could retarget ANOTHER
        // resource's replay row under the same principal/route/key.
        // Onboarding inserts NULL resource_id, so completion must pin NULL
        // explicitly (SQL `= NULL` never matches).
        scope.resourceId === null
          ? isNull(idempotencyRequests.resourceId)
          : eq(idempotencyRequests.resourceId, scope.resourceId),
      ),
    );
}

/** JSONB columns accept objects; non-object bodies are wrapped verbatim. */
function ensureJsonRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return { body };
}
