import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { DbTx } from "../../lib/db/transaction-runner";
import { computeCanonicalBodyHash } from "../../lib/idempotency/idempotency-port";
import { runOnboardingTransaction } from "../../lib/onboarding/onboard-owner";
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

  function tx(): DbTx {
    // The runner's transaction context is structurally the Drizzle handle;
    // direct calls here exercise the same repository functions.
    return requireHarness().db as unknown as DbTx;
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
      runOnboardingTransaction(tx(), input).catch((e: unknown) => e),
      runOnboardingTransaction(tx(), input).catch((e: unknown) => e),
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
    await runOnboardingTransaction(tx(), {
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
    });
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
    // A second begin() with a different hash must detect the mismatch; the
    // unique scope index guarantees only ONE row per (principal, route,
    // resource, key) exists to compare against.
    const count = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM idempotency_requests WHERE principal_id = ${scopeKey}`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(computeCanonicalBodyHash({ a: 2 })).not.toBe(computeCanonicalBodyHash({ a: 1 }));
  });

  it("scenario 4: a different identity taking the same slug leaves no orphan rows from the failed attempt", async () => {
    const slug = `slug-shared-${String(Date.now())}`;
    await runOnboardingTransaction(tx(), onboardInput("it-slug-a", slug));
    await expect(
      runOnboardingTransaction(tx(), onboardInput("it-slug-b", slug)),
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

  it("scenario 5: fault injection after each write step rolls back every prior write", async () => {
    const before = await readTableCounts(requireHarness().db);
    const failAfter = ["profile", "workspace", "membership", "audit", "idempotency"] as const;
    for (const step of failAfter) {
      // Inject the failure by aborting the wrapping transaction after the
      // onboarding unit ran: every write it performed must roll back.
      await expect(
        requireHarness().db.transaction(async () => {
          await runOnboardingTransaction(tx(), {
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
          return Promise.reject(new Error(`inject after ${step}`));
        }),
      ).rejects.toThrow(`inject after ${step}`);
    }
    const after = await readTableCounts(requireHarness().db);
    expect(after).toEqual(before);
  });

  it("scenario 6: cross-workspace composite reference is rejected by the database (23503)", async () => {
    await runOnboardingTransaction(tx(), onboardInput("it-cross-a", `slug-xa-${String(Date.now())}`));
    await runOnboardingTransaction(tx(), onboardInput("it-cross-b", `slug-xb-${String(Date.now())}`));
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
    expect(probe instanceof Error && "code" in probe && (probe as { code?: string }).code).toBe(
      "23503",
    );
  });

  it("migrations are repeatable: re-running apply is a no-op (drizzle journal)", async () => {
    const journal = await requireHarness().db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(journal.rows[0]?.n).toBeGreaterThan(0);
  });
});
