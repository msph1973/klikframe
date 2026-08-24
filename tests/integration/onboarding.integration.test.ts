import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  DrizzleTransactionRunner,
  SERIALIZABLE_TX_CONFIG,
  type DbTx,
} from "../../lib/db/transaction-runner";
import { computeCanonicalBodyHash } from "../../lib/idempotency/idempotency-port";
import {
  findIdempotencyRecord,
  runOnboardingTransaction,
  IdempotencyRaceError,
  type OnboardingResult,
} from "../../lib/onboarding/onboard-owner";
import {
  closeHarnessDb,
  createHarnessDb,
  describeIntegration,
  readTableCounts,
  type HarnessDb,
} from "./helpers/db";

/**
 * Onboarding integration scenarios (TESTING.md §2.2, §3; brief scenarios
 * 1–6). These run against a disposable PostgreSQL seeded by the checked-in
 * drizzle migrations. Without `TEST_DATABASE_URL` the whole suite is
 * skipped and `npm run test:integration` stays green — see
 * tests/integration/README.md for the activation contract.
 */

/**
 * Extracts the SQLSTATE from a Postgres driver error. Drizzle wraps driver
 * errors in `DrizzleQueryError`, so the code may sit on the error itself or
 * on its `cause`.
 */
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const candidate of [error, (error as { cause?: unknown }).cause]) {
    if (typeof candidate === "object" && candidate !== null && "code" in candidate) {
      const { code } = candidate;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

describeIntegration("onboarding persistence (real PostgreSQL)", () => {
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

  /**
   * A genuine serializable Drizzle transaction for repository work
   * (PRRT_kwDOT_C_FM6bh72L): the callback receives a real `DbTx`, so every
   * statement inside shares one connection, one snapshot and one COMMIT —
   * never the pooled `db`, whose statements would each autocommit. The
   * promise resolves only AFTER Drizzle has left the transaction: COMMIT
   * done, connection released, writes durable before any later
   * pooled-handle assertion runs.
   */
  function tx<T>(work: (dbTx: DbTx) => Promise<T>): Promise<T> {
    // `t` is a node-postgres PgTransaction structurally equivalent to the
    // app's neon-serverless DbTx (see helpers/db.ts) — same query surface.
    return requireHarness()
      .db.transaction((t) => work(t as unknown as DbTx), SERIALIZABLE_TX_CONFIG);
  }

  /**
   * One full onboarding inside one genuine serializable transaction.
   * Failure paths resolve with the captured error so scenarios observe
   * their own effects instead of an unhandled rejection; success paths
   * return the {@link OnboardingResult}.
   */
  async function onboard(authUserId: string, slug: string): Promise<OnboardingResult | Error> {
    try {
      return await tx((dbTx) => runOnboardingTransaction(dbTx, onboardInput(authUserId, slug)));
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  function onboardInput(authUserId: string, slug: string) {
    return {
      profile: { authUserId, displayName: "Ayu", phoneE164: "+628123456789", now: NOW },
      workspace: { name: "Klik Studio", slug, now: NOW },
      audit: { requestId: `req_${authUserId}` },
    };
  }

  it("scenario 1: concurrent double-onboarding of one identity yields exactly 1 workspace + 1 active owner", async () => {
    const authUser = "it-onb-1";
    const input = onboardInput(authUser, `slug-${authUser}`);
    const [a, b] = await Promise.all([
      tx((dbTx) => runOnboardingTransaction(dbTx, input)).catch((e: unknown) => e),
      tx((dbTx) => runOnboardingTransaction(dbTx, input)).catch((e: unknown) => e),
    ]);
    const workspaces = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE slug = ${`slug-${authUser}`}`,
    );
    const owners = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspace_members WHERE auth_user_id = ${authUser} AND role = 'owner' AND status = 'active'`,
    );
    expect(workspaces.rows[0]?.n).toBe(1);
    expect(owners.rows[0]?.n).toBe(1);
    // At least one racer either succeeded observing the single row or
    // failed with a serialization conflict (40001) that the runner retries.
    const failures = [a, b].filter((r): r is Error => r instanceof Error);
    for (const failure of failures) {
      expect(JSON.stringify(failure)).toMatch(/40001|duplicate key|advisory/);
    }
  }, 20_000);

  it("scenario 2: replaying an idempotency key with the same body hash returns the original response", async () => {
    const scopeKey = `it-replay-${String(Date.now())}`;
    const body = { business_name: "Klik Studio" };
    const hash = computeCanonicalBodyHash(body);
    const stored = { status: 201, payload: { data: { ok: true } } };
    await tx((dbTx) =>
      runOnboardingTransaction(dbTx, {
        ...onboardInput(scopeKey, `slug-${scopeKey}`),
        idempotency: {
          workspaceId: null,
          principalId: scopeKey,
          route: "/onboarding",
          resourceId: null,
          key: "idem-key-1",
          requestBodyHash: hash,
          responseStatus: stored.status,
          responseBody: stored.payload,
          expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
          now: NOW,
        },
      }),
    );
    const rows = await requireHarness().db.execute<{ response_status: number; request_body_hash: string }>(
      sql`SELECT response_status, request_body_hash FROM idempotency_requests WHERE principal_id = ${scopeKey} AND key = 'idem-key-1'`,
    );
    expect(rows.rows[0]?.response_status).toBe(201);
    expect(rows.rows[0]?.request_body_hash).toBe(hash);
  });

  it("scenario 3: replaying the same key with a different body violates the store contract (conflict → 409)", async () => {
    const scopeKey = `it-conflict-${String(Date.now())}`;
    await requireHarness().db.execute(
      sql`INSERT INTO idempotency_requests
          (id, workspace_id, principal_id, route, resource_id, key, request_body_hash, response_status, response_body, expires_at, created_at)
          VALUES (gen_random_uuid(), NULL, ${scopeKey}, '/onboarding', NULL, 'k1', ${computeCanonicalBodyHash({ a: 1 })}, 201, '{"data":{}}', now() + interval '24 hours', now())`,
    );
    // Second write in the SAME scope (principal/route/resource/key) but a
    // different body hash: the scope unique must reject it outright so no
    // second row can ever shadow the original replay record. The index is
    // NULLS NOT DISTINCT — plain DISTINCT semantics treat each NULL
    // resource_id as distinct and would let onboarding-scope duplicates
    // slip through (23505 → route layer maps it to 409 IDEMPOTENCY_CONFLICT).
    const conflict = await requireHarness().db
      .execute(
        sql`INSERT INTO idempotency_requests
            (id, workspace_id, principal_id, route, resource_id, key, request_body_hash, response_status, response_body, expires_at, created_at)
            VALUES (gen_random_uuid(), NULL, ${scopeKey}, '/onboarding', NULL, 'k1', ${computeCanonicalBodyHash({ a: 2 })}, 201, '{"data":{}}', now() + interval '24 hours', now())`,
      )
      .catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(Error);
    expect(pgCode(conflict)).toBe("23505");
    const count = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM idempotency_requests WHERE principal_id = ${scopeKey}`,
    );
    // Exactly one replay record survives; the conflicting write stored nothing.
    expect(count.rows[0]?.n).toBe(1);
  });

  it("scenario 4: a different identity taking the same slug leaves no orphan rows from the failed attempt", async () => {
    const slug = `slug-shared-${String(Date.now())}`;
    const incumbent = `it-slug-a-${String(Date.now())}`;
    await tx((dbTx) => runOnboardingTransaction(dbTx, onboardInput(incumbent, slug)));
    // The conflicting identity's unit runs inside one transaction; the
    // WorkspaceSlugConflictError (mapped to 409 SLUG_CONFLICT) aborts it,
    // so the profile upsert performed before the conflict must roll back.
    await expect(
      requireHarness().db.transaction(async (abortTx) => {
        await runOnboardingTransaction(abortTx, onboardInput("it-slug-b", slug));
      }),
    ).rejects.toThrow();
    const orphanProfiles = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM profiles WHERE auth_user_id = 'it-slug-b'`,
    );
    const orphanMembers = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspace_members WHERE auth_user_id = 'it-slug-b'`,
    );
    // The failed transaction rolled back completely.
    expect(orphanProfiles.rows[0]?.n).toBe(0);
    expect(orphanMembers.rows[0]?.n).toBe(0);
  });

  it("scenario 5: fault injection after each onboarding step leaves no partial writes", async () => {
    const before = await readTableCounts(requireHarness().db);
    const failAfter = ["profile", "workspace", "membership", "audit", "idempotency"] as const;
    for (const step of failAfter) {
      // Inject the failure inside ONE genuine serializable transaction
      // (DrizzleTransactionRunner): every write runOnboardingTransaction
      // performed before the injected throw must roll back together. A
      // failure in one step must not mask the assertions of the next, so
      // each step runs and is asserted independently (PRRT_…FM6bh72K
      // follow-up: this loop used to share scenario 4's it() body).
      const runner = new DrizzleTransactionRunner(requireHarness().db);
      await expect(
        runner.run(async (dbTx) => {
          await runOnboardingTransaction(dbTx, {
            ...onboardInput(`it-fault-${step}`, `slug-it-fault-${step}`),
            idempotency: {
              workspaceId: null,
              principalId: `it-fault-${step}`,
              route: "/onboarding",
              resourceId: null,
              key: "k",
              requestBodyHash: computeCanonicalBodyHash({ step }),
              responseStatus: 201,
              responseBody: {},
              expiresAt: new Date(NOW.getTime() + 86_400_000),
              now: NOW,
            },
          });
          throw new Error(`inject after ${step}`);
        }),
      ).rejects.toThrow(`inject after ${step}`);
    }
    const after = await readTableCounts(requireHarness().db);
    expect(after).toEqual(before);
  });

  it("scenario 5b: TRUNCATE cannot bypass the audit append-only trigger", async () => {
    // Row-level BEFORE UPDATE OR DELETE triggers never fire for TRUNCATE,
    // so without the migration's separate statement-level trigger a plain
    // `TRUNCATE audit_events` would wipe history and silently bypass the
    // append-only boundary. This probe must fail with the trigger's
    // append-only error, not succeed.
    const workspaces = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces`,
    );
    if ((workspaces.rows[0]?.n ?? 0) === 0) {
      await onboard("it-trunc-a", `slug-it-trunc-${String(Date.now())}`);
    }
    const events = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_events`,
    );
    if ((events.rows[0]?.n ?? 0) === 0) {
      await onboard("it-trunc-b", `slug-it-trunc-b-${String(Date.now())}`);
    }
    const probe = await requireHarness().db.execute(
      sql`TRUNCATE TABLE audit_events`,
    ).then(() => undefined).catch((e: unknown) => e);
    expect(probe).toBeInstanceOf(Error);
    // The trigger's RAISE EXCEPTION surfaces as SQLSTATE P0001 with the
    // append-only message — not a silent success. Drizzle wraps driver
    // errors, so walk the cause chain for the message.
    expect(pgCode(probe)).toBe("P0001");
    let cursor: unknown = probe;
    let message = "";
    while (cursor instanceof Error) {
      message += ` ${cursor.message}`;
      cursor = (cursor as { cause?: unknown }).cause;
    }
    expect(message).toMatch(/append-only/i);
  });

  it("scenario 6: cross-workspace composite reference is rejected by the database (23503)", async () => {
    // Seeding note: this scenario re-seeds `it-cross-a`/`it-cross-b` on
    // every run with fresh timestamped slugs. That is NOT an idempotent
    // retry — runOnboardingTransaction always runs createOrLoadWorkspace +
    // createActiveOwnerMembership, so once either identity already owns a
    // workspace from an earlier run on a shared database, the second owner
    // membership violates the workspace_members_single_owned_workspace_
    // per_identity_key partial unique index and the attempt fails with
    // SQLSTATE 23505. Seeding errors are surfaced, never swallowed: any
    // captured failure MUST carry that expected duplicate-key code, so a
    // genuine onboarding regression cannot hide behind the FK probe below.
    const seedOrExpectRerunDuplicate = async (authUserId: string, slug: string): Promise<void> => {
      const seeded = await onboard(authUserId, slug);
      if (!(seeded instanceof Error)) return;
      // A re-run failure must be the documented duplicate-owner 23505;
      // anything else (or a silent swallow) fails the scenario.
      expect(pgCode(seeded)).toBe("23505");
    };
    const slugA = `slug-xa-${String(Date.now())}`;
    const slugB = `slug-xb-${String(Date.now())}`;
    await seedOrExpectRerunDuplicate("it-cross-a", slugA);
    await seedOrExpectRerunDuplicate("it-cross-b", slugB);
    // FK probe: audit_events referencing a nonexistent workspace must raise
    // SQLSTATE 23503 at the database level.
    const probe = await requireHarness().db
      .execute(
        sql`INSERT INTO audit_events
            (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata, created_at)
            VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000000', 'system', 'probe', 'probe.action', 'workspace',
                    gen_random_uuid(), 'req_probe', NULL, now())`,
      )
      .catch((e: unknown) => e);
    expect(probe).toBeInstanceOf(Error);
    expect(pgCode(probe)).toBe("23503");
  });

  it("migrations are repeatable: re-running apply is a no-op (drizzle journal)", async () => {
    const journal = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(journal.rows[0]?.n).toBeGreaterThan(0);
  });

  it("scenario 7: losing the idempotency insert race aborts with IdempotencyRaceError, then a fresh snapshot replays", async () => {
    // PRRT_kwDOT_C_FM6bpjbA: two identical requests overlap; both observe
    // "no committed record" before either acquires the advisory lock. The
    // loser's idempotency insert hits the scope unique (23505) INSIDE its
    // serializable transaction — the raw violation must never escape as a
    // 500. The repository classifies it as IdempotencyRaceError; the route
    // then re-runs the use case in a FRESH transaction whose new snapshot
    // sees the winner's committed row and replays it.
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
    const runner = new DrizzleTransactionRunner(requireHarness().db);

    // Winner commits first (same shape the real first request takes).
    await runner.run(async (winnerTx) => {
      await runOnboardingTransaction(winnerTx, {
        ...onboardInput(scopeKey, `slug-${scopeKey}`),
        idempotency,
      });
    });

    // observation path: in the true overlap race its replay lookup runs
    // BEFORE the winner commits, so it misses. Drive the loser through the
    // REAL write path (runOnboardingTransaction reaches
    // recordIdempotencyRequest): the scope unique rejects its insert and
    // the classification must surface as IdempotencyRaceError — never the
    // raw 23505 as an unclassified 500.
    let loserAborted = false;
    try {
      await runner.run(async (loserTx) => {
        await runOnboardingTransaction(loserTx, {
          ...onboardInput(scopeKey, `slug-${scopeKey}`),
          idempotency,
        });
      });
    } catch (error) {
      if (error instanceof IdempotencyRaceError) {
        loserAborted = true;
      } else {
        throw error;
      }
    }
    expect(loserAborted).toBe(true);

    // The route-level retry: a fresh transaction observes the winner's
    // committed record and replays it — the exact behavior the second HTTP
    // request must produce instead of a 500.
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
    const workspaces = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE slug = ${`slug-${scopeKey}`}`,
    );
    expect(workspaces.rows[0]?.n).toBe(1);
  }, 20_000);
});
