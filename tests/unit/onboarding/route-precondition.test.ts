import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { createApp, type KlikFrameApp } from "../../../lib/http/app";
import { setIdentitySessionPort } from "../../../lib/auth/server";
import type { IdentitySessionPort, SessionResolution } from "../../../lib/auth/identity-session-port";
import { resetEnvCacheForTests } from "../../../lib/config/env";
import { resetProvidersForTests } from "../../../lib/providers/composition";
import { computeCanonicalBodyHash } from "../../../lib/idempotency/idempotency-port";
import type { Db } from "../../../lib/db/client";

/**
 * Route-level regressions for the ALREADY_ONBOARDED precondition ordering
 * (PRRT_kwDOT_C_FM6bpRIt, PRRT_kwDOT_C_FM6bsYro, PRRT_kwDOT_C_FM6btFPe,
 * PRRT_kwDOT_C_FM6bspCN) against a canned-answer fake transaction — no
 * PostgreSQL involved:
 * - a genuine replay short-circuits to its stored 201 BEFORE the ownership
 *   precondition can observe the committed membership;
 * - the first-time path rejects an already-onboarded identity with the
 *   frozen 409 envelope;
 * - losing the concurrent first-time race surfaces as 409
 *   ALREADY_ONBOARDED — never the raw unique violation as a 500.
 */

vi.mock("../../../lib/db/client", () => ({
  getDb: vi.fn(),
  resetDbClientForTests: vi.fn(),
}));

import { getDb } from "../../../lib/db/client";

const APP_ORIGIN = "https://app.klikframe.example";

const VALID_PAYLOAD = {
  business_name: "Klik Studio",
  slug: "klik-studio",
  owner_display_name: "Ayu",
};

/** One canned answer consumed by the next completing query chain. */
type Answer = { rows: Record<string, unknown>[] } | { fail: unknown };

interface FakeDbTx {
  select(): unknown;
  insert(): unknown;
  execute(): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Builds a fake serializable transaction: `select`/`insert` chains consume
 * the answer FIFO at their terminal call; `execute` (advisory lock) always
 * succeeds. Mirrors the fake in tests/unit/db/onboarding-repository.test.ts.
 */
function makeFakeTx(answers: Answer[]): FakeDbTx {
  const queue = [...answers];

  function nextRows(): Record<string, unknown>[] {
    const answer = queue.shift();
    if (answer === undefined) throw new Error("fake tx ran out of answers");
    if ("fail" in answer) throw answer.fail;
    return answer.rows;
  }

  function chainWithTerminal(terminal: () => Promise<Record<string, unknown>[]>): unknown {
    const builder = {
      values() {
        return builder;
      },
      onConflictDoNothing() {
        return builder;
      },
      onConflictDoUpdate() {
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return builder;
      },
      from() {
        return builder;
      },
      returning: terminal,
      then(onFulfilled: (rows: Record<string, unknown>[]) => unknown) {
        return terminal().then(onFulfilled);
      },
    };
    return builder;
  }

  return {
    select() {
      return chainWithTerminal(() => Promise.resolve(nextRows()));
    },
    insert() {
      return chainWithTerminal(() => Promise.resolve(nextRows()));
    },
    execute: () => Promise.resolve({ rows: [] }),
  };
}

function fakeDbFrom(answers: Answer[]): Db {
  const fakeTx = makeFakeTx(answers);
  return {
    transaction: (work: (tx: unknown) => Promise<unknown>) => work(fakeTx),
  } as unknown as Db;
}

let previousEnv: Record<string, string | undefined>;

beforeEach(() => {
  previousEnv = {
    APP_ORIGIN: process.env.APP_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  (process.env as Record<string, string | undefined>).APP_ORIGIN = APP_ORIGIN;
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  resetEnvCacheForTests();
});

afterEach(() => {
  const record = process.env as Record<string, string | undefined>;
  for (const key of ["APP_ORIGIN", "NODE_ENV"] as const) {
    if (previousEnv[key] === undefined) delete record[key];
    else record[key] = previousEnv[key];
  }
  resetEnvCacheForTests();
  setIdentitySessionPort(new (class implements IdentitySessionPort {
    resolveSession(): Promise<SessionResolution> {
      return Promise.resolve({ kind: "unauthenticated" });
    }
  })());
  resetProvidersForTests();
  vi.mocked(getDb).mockReset();
});

function seedAuthenticatedSession(authUserId = "user_pre"): void {
  setIdentitySessionPort({
    resolveSession() {
      return Promise.resolve({
        kind: "authenticated",
        session: {
          identity: { authUserId, email: "owner@example.com" },
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    },
  });
}

async function post(app: KlikFrameApp): Promise<Response> {
  return app.request("/api/v1/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_ORIGIN,
      "idempotency-key": "itest-0123456789abcdef",
    },
    body: JSON.stringify(VALID_PAYLOAD),
  });
}

const STORED_BODY = {
  data: {
    profile: { id: "prof_1", display_name: "Ayu" },
    business: { id: "ws_1", name: "Klik Studio", slug: "klik-studio", status: "active" },
    membership: { role: "owner", status: "active" },
  },
};

describe("POST /api/v1/onboarding — ALREADY_ONBOARDED ordering", () => {
  it("a genuine replay short-circuits to its stored 201 even though the owner membership exists", async () => {
    // PRRT_kwDOT_C_FM6bsYro: the idempotency record and the owner membership
    // commit together on first success, so the replay lookup MUST win over
    // the precondition. The membership SELECT answer below never gets
    // consumed — if the route ran assertNotAlreadyOnboarded on the replay
    // path the request would die 409 instead of replaying.
    seedAuthenticatedSession();
    const hash = computeCanonicalBodyHash(VALID_PAYLOAD);
    // Drizzle maps snake_case columns onto the camelCase projection fields,
    // so the fake must answer with the projected shape verbatim.
    vi.mocked(getDb).mockReturnValue(fakeDbFrom([
      {
        rows: [
          { requestBodyHash: hash, responseStatus: 201, responseBody: STORED_BODY },
        ],
      },
      { rows: [{ id: "mem-that-must-not-be-read" }] },
    ]));
    const res = await post(createApp());
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await res.json()).toEqual(STORED_BODY);
  });

  it("rejects a first-time request from an identity that already owns a workspace with 409 ALREADY_ONBOARDED", async () => {
    // PRRT_kwDOT_C_FM6bpRIt: an onboarded owner submitting another slug is
    seedAuthenticatedSession();
    vi.mocked(getDb).mockReturnValue(fakeDbFrom([
      { rows: [] }, // replay lookup misses
      { rows: [{ id: "mem-existing-owner" }] }, // active owner membership found
    ]));
    const res = await post(createApp());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_ONBOARDED");
  });

  it("maps the concurrent first-time race (23505 on the membership insert) to 409 ALREADY_ONBOARDED", async () => {
    // PRRT_kwDOT_C_FM6bspCN: both prechecks passed, the winner committed,
    // and the loser's fresh-path membership insert hits the partial unique.
    // The wrapped driver violation must classify — never escape raw.
    seedAuthenticatedSession();
    const violation = new Error("drizzle wrapper", {
      cause: Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }),
    });
    vi.mocked(getDb).mockReturnValue(fakeDbFrom([
      { rows: [] }, // replay lookup misses
      { rows: [] }, // ownership precondition passes
      { rows: [{ id: "prof_1" }] }, // profile upsert
      { rows: [{ id: "ws_1", name: "Klik Studio", slug: "klik-studio", status: "active" }] }, // workspace insert
      { fail: violation }, // membership insert hits the unique index
    ]));
    const res = await post(createApp());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ALREADY_ONBOARDED");
  });

  it("still rejects a replay whose body differs from the stored record with 409 IDEMPOTENCY_CONFLICT", async () => {
    seedAuthenticatedSession();
    vi.mocked(getDb).mockReturnValue(fakeDbFrom([
      { rows: [{ requestBodyHash: "different-hash", responseStatus: 201, responseBody: {} }] },
    ]));
    const res = await post(createApp());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
