import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  DrizzleTransactionRunner,
  SERIALIZABLE_TX_CONFIG,
  advisoryLockKeyString,
  type DbTx,
} from "../../lib/db/transaction-runner";
import { computeCanonicalBodyHash } from "../../lib/idempotency/idempotency-port";
import {
  findIdempotencyRecord,
  runOnboardingTransaction,
  IdempotencyRaceError,
  AlreadyOnboardedRaceError,
  assertNotAlreadyOnboarded,
} from "../../lib/onboarding/onboard-owner";
import {
  closeHarnessDb,
  createHarnessDb,
  describeIntegration,
  type HarnessDb,
} from "./helpers/db";

/**
 * Overlap-race scenarios for onboarding (TESTING.md §2.2; brief scenario
 * coverage for PRRT_kwDOT_C_FM6bpjbA / FM6bspCX / FM6bspCN /
 * FM6bpRIt). Split out of onboarding.integration.test.ts to keep both files
 * inside the TESTING.md §6 file-size gate; the harness contract is shared
 * (tests/integration/README.md): disposable PostgreSQL via TEST_DATABASE_URL,
 * migrations applied by CI, seeding through the repository functions only.
 */

describeIntegration("onboarding overlap races (real PostgreSQL)", () => {
  const NOW = new Date("2026-01-15T08:00:00.000Z");
  let harness: HarnessDb | undefined;

  beforeAll(() => {
    harness = createHarnessDb();
  });

  afterAll(async () => {
    if (harness !== undefined) {
      await closeHarnessDb(harness);
    }
  });

  function requireHarness(): HarnessDb {
    // beforeAll ran before any test body executes.
    if (harness === undefined) throw new Error("harness not initialised");
    return harness;
  }

  function onboardInput(authUserId: string, slug: string) {
    return {
      profile: { authUserId, displayName: "Ayu", phoneE164: "+628123456789", now: NOW },
      workspace: { name: "Klik Studio", slug, now: NOW },
      audit: { requestId: `req_${authUserId}` },
    };
  }

  it("scenario 7: genuine overlap — loser's stale snapshot aborts (40001→retry replays), duplicate insert classifies IdempotencyRaceError", async () => {
    // PRRT_kwDOT_C_FM6bpjbA + PRRT_kwDOT_C_FM6bspCX: TWO IDENTICAL REQUESTS
    // genuinely OVERLAP — the loser's replay lookup runs against its
    // pre-winner snapshot and MISSES while the winner's writes are staged
    // (commit held open by a barrier). Under serializable isolation the
    // loser's subsequent write then touches a tuple the winner created
    // after that snapshot and Postgres aborts it with SQLSTATE 40001
    // (ExecCheckTupleVisible) — the exact failure the route's
    // DrizzleTransactionRunner retries in a FRESH transaction, whose new
    // snapshot observes the winner's committed idempotency record and
    // replays it. The overlapping half pins that production interleaving;
    // the second half drives a duplicate insert straight at the committed
    // store to pin the 23505 → IdempotencyRaceError classification itself.
    const scopeKey = `it-race-${String(Date.now())}`;
    const body = { business_name: "Klik Studio" };
    const hash = computeCanonicalBodyHash(body);
    const idempotency = {
      workspaceId: null,
      principalId: scopeKey,
      route: "/api/v1/onboarding",
      resourceId: null,
      key: "race-key-1",
      requestBodyHash: hash,
      responseStatus: 201,
      responseBody: {},
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      now: NOW,
    };
    const input = { ...onboardInput(scopeKey, `slug-${scopeKey}`), idempotency };
    const db = requireHarness().db;
    // Deterministic handoff: the WINNER takes the advisory lock first and
    // only then signals the loser into the write path, so the loser is
    // guaranteed to block on the lock — never the reverse.
    const winnerHoldsLock = Promise.withResolvers<void>();
    const loserLookupDone = Promise.withResolvers<void>();

    // LOSER: opens its transaction FIRST, misses the replay lookup against
    // the empty store, then enters the write path — where it blocks on the
    // advisory lock the winner already holds.
    type LoserOutcome = { kind: "committed" } | { kind: "failed"; sqlstate?: string | undefined };
    const loserFirstAttempt = (async (): Promise<LoserOutcome> => {
      try {
        return await db.transaction(async (loserTx) => {
          const existing = await findIdempotencyRecord(loserTx as unknown as DbTx, {
            principalId: scopeKey,
            route: "/api/v1/onboarding",
            key: "race-key-1",
          });
          if (existing !== null) {
            throw new Error("loser unexpectedly observed the uncommitted winner");
          }
          // Snapshot is now pinned pre-winner; enter the write path, where
          // this tx blocks on the advisory lock the winner already holds.
          await winnerHoldsLock.promise;
          loserLookupDone.resolve();
          await runOnboardingTransaction(loserTx as unknown as DbTx, input);
          return { kind: "committed" as const };
        }, SERIALIZABLE_TX_CONFIG);
      } catch (error) {
        return { kind: "failed" as const, sqlstate: pgCode(error) };
      }
    })();

    // WINNER: takes the advisory lock FIRST (so the loser is guaranteed to
    // be the one that blocks), stages every write, then holds COMMIT until
    // the loser has pinned its stale snapshot with a missed replay lookup.
    const winnerCommit = (async (): Promise<"committed" | Error> => {
      try {
        return await db.transaction(async (winnerTx) => {
          const tx = winnerTx as unknown as DbTx;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${advisoryLockKeyString(scopeKey)}::int8)`);
          winnerHoldsLock.resolve();
          await runOnboardingTransaction(tx, input);
          await loserLookupDone.promise;
          return "committed" as const;
        }, SERIALIZABLE_TX_CONFIG);
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })();

    const [loserOutcome, winnerOutcome] = await Promise.all([loserFirstAttempt, winnerCommit]);
    expect(winnerOutcome).toBe("committed");
    // The loser's stale-snapshot abort is a serialization failure (40001),
    // which the route's runner retries in a fresh snapshot — never a raw
    // constraint violation leaking out of the overlap.
    expect(loserOutcome.kind).toBe("failed");
    if (loserOutcome.kind === "failed") {
      expect(loserOutcome.sqlstate).toBe("40001");
    }

    // Route retry semantics: a fresh transaction observes the winner's
    // committed record and replays it — what the second HTTP request must
    // produce instead of a 500.
    const runner = new DrizzleTransactionRunner(db);
    const replay = await runner.run((retryTx) =>
      findIdempotencyRecord(retryTx, {
        principalId: scopeKey,
        route: "/api/v1/onboarding",
        key: "race-key-1",
      }),
    );
    expect(replay).not.toBeNull();
    expect(replay?.requestBodyHash).toBe(hash);
    expect(replay?.responseStatus).toBe(201);

    // Exactly one business account exists — the loser stored nothing.
    const workspaces = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE slug = ${`slug-${scopeKey}`}`,
    );
    expect(workspaces.rows[0]?.n).toBe(1);

    // Classification half (PRRT_kwDOT_C_FM6bpjbA): a duplicate write driven
    // at the COMMITTED store (no replay lookup, as a caller skipping the
    // route's lookup would do) hits the scope unique inside a serializable
    // transaction and MUST surface classified as IdempotencyRaceError —
    // never the raw 23505.
    let race: unknown;
    try {
      await runner.run(async (dupeTx) => {
        await runOnboardingTransaction(dupeTx, input);
      });
    } catch (error) {
      race = error;
    }
    expect(race).toBeInstanceOf(IdempotencyRaceError);
  }, 20_000);

  it("scenario 8: first-time ownership race — overlap aborts via serialization, duplicate insert classifies AlreadyOnboardedRaceError, precondition rejects", async () => {
    // PRRT_kwDOT_C_FM6bspCN + PRRT_kwDOT_C_FM6bpRIt. Three layers pin the
    // ALREADY_ONBOARDED contract:
    // (1) GENUINE OVERLAP — the loser's tx opens and its precondition
    //     SELECT passes against the pre-winner snapshot (membership not
    //     visible) while the winner holds COMMIT open; the loser's write
    //     then touches a winner-created tuple and Postgres aborts it with
    //     SQLSTATE 40001, which the route's DrizzleTransactionRunner
    //     retries in a fresh snapshot where the precondition resolves.
    // (2) CLASSIFICATION — a duplicate write driven straight at the
    //     committed store (precheck skipped) hits the single-owned-
    //     workspace-per-identity partial unique inside a serializable
    //     transaction; the repository MUST classify it as
    //     AlreadyOnboardedRaceError (route → 409), never a raw 23505.
    // (3) PRECONDITION — after commit, assertNotAlreadyOnboarded on a plain
    //     caller-provided tx rejects before any write happens.
    const authUser = `it-owner-race-${String(Date.now())}`;
    const slug = `slug-${authUser}`;
    const db = requireHarness().db;
    const input = onboardInput(authUser, slug);
    const loserPrecheckDone = Promise.withResolvers<void>();

    type LoserOutcome = { kind: "committed" } | { kind: "failed"; sqlstate?: string | undefined };

    // LOSER FIRST: passes its ownership precheck against the empty store,
    // then enters the write path behind the winner's advisory lock.
    const winnerHoldsLock = Promise.withResolvers<void>();
    // Wait for the winner to hold the advisory lock BEFORE consuming a
    // pooled connection: awaiting inside the tx callback would risk both
    // transactions pinning their connections against each other.
    await winnerHoldsLock.promise;
    const loserFirstAttempt = (async (): Promise<LoserOutcome> => {
      try {
        return await db.transaction(async (loserTx) => {
          const tx = loserTx as unknown as DbTx;
          // Precheck runs while every winner write is still uncommitted —
          // this pins the pre-winner serializable snapshot.
          await assertNotAlreadyOnboarded(tx, authUser);
          loserPrecheckDone.resolve();
          // Now enter the write path: block on the winner's advisory lock,
          // then lose the race against its staged writes.
          await runOnboardingTransaction(tx, input);
          return { kind: "committed" as const };
        }, SERIALIZABLE_TX_CONFIG);
      } catch (error) {
        return { kind: "failed" as const, sqlstate: pgCode(error) };
      }
    })();

    // WINNER: takes the advisory lock FIRST (so the loser is guaranteed to
    // be the one that blocks), stages every write under it, and holds
    // COMMIT until the loser's precondition has pinned its stale snapshot.
    const winnerCommit = (async (): Promise<"committed" | Error> => {
      try {
        return await db.transaction(async (winnerTx) => {
          const tx = winnerTx as unknown as DbTx;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${advisoryLockKeyString(authUser)}::int8)`);
          // Lock held: release the loser. Its precheck SELECT runs against
          // our still-uncommitted state, pins the stale snapshot and
          // resolves the gate below; only then do we stage our own writes.
          winnerHoldsLock.resolve();
          await runOnboardingTransaction(tx, input);
          await loserPrecheckDone.promise;
          return "committed" as const;
        }, SERIALIZABLE_TX_CONFIG);
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })();

    const [loserOutcome, winnerOutcome] = await Promise.all([loserFirstAttempt, winnerCommit]);
    expect(winnerOutcome).toBe("committed");
    expect(loserOutcome.kind).toBe("failed");
    if (loserOutcome.kind === "failed") {
      expect(loserOutcome.sqlstate).toBe("40001");
    }

    // Classification half (PRRT_kwDOT_C_FM6bpRIt): an onboarded owner
    // submitting a NEW slug takes the FRESH write path (new workspace, no
    // committed membership to pre-SELECT), so the single-owned-workspace-
    // per-identity partial unique rejects its insert with 23505 — which
    // the repository MUST classify as AlreadyOnboardedRaceError (the route
    // maps it to the frozen 409), never leak as a raw violation.
    let race: unknown;
    try {
      await db.transaction(async (dupeTx) => {
        await runOnboardingTransaction(dupeTx as unknown as DbTx, onboardInput(authUser, `${slug}-second`));
      }, SERIALIZABLE_TX_CONFIG);
    } catch (error) {
      race = error;
    }
    expect(race).toBeInstanceOf(AlreadyOnboardedRaceError);

    // Exactly one workspace and one active owner exist.
    const owners = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspace_members WHERE auth_user_id = ${authUser} AND role = 'owner' AND status = 'active'`,
    );
    expect(owners.rows[0]?.n).toBe(1);
    const workspaces = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE slug = ${slug}`,
    );
    expect(workspaces.rows[0]?.n).toBe(1);

    // Precondition half: post-commit, a first-time-shaped request for this
    // identity is rejected BEFORE any write — on a plain caller-provided
    // transaction, exactly as the route invokes it inside runOnce.
    await expect(
      db.transaction(async (lateTx) => {
        await assertNotAlreadyOnboarded(lateTx as unknown as DbTx, authUser);
      }, SERIALIZABLE_TX_CONFIG),
    ).rejects.toThrow("Identity already owns a workspace");
  }, 20_000);
});

/** Extracts the SQLSTATE from a Postgres driver error (Drizzle wraps it). */
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && typeof candidate === "object" && candidate !== null; depth += 1) {
    const maybeCode: unknown = (candidate as { code?: unknown }).code;
    if (typeof maybeCode === "string") return maybeCode;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return undefined;
}

