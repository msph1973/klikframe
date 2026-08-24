import { describe, expect, it } from "vitest";

import {
  createActiveOwnerMembership,
  createOrLoadWorkspace,
  requireId,
  upsertProfile,
  WorkspaceSlugConflictError,
} from "../../../lib/onboarding/repository";
import type { DbTx } from "../../../lib/db/transaction-runner";

/**
 * Unit coverage for the onboarding repository logic (P0 PRRT_kwDOT_C_FM6bh711,
 * P1 PRRT_kwDOT_C_FM6bh713) against a fake Drizzle transaction — no
 * PostgreSQL involved. The fake resolves every query chain from a FIFO
 * queue of canned answers and counts raw inserts plus owner lookups, so
 * the load-vs-insert branching is exercised directly.
 */
const NOW = new Date("2026-01-15T08:00:00.000Z");

interface CannedAnswer {
  kind: "insert-returning" | "select-owner" | "select-workspace" | "select-membership";
  rows: Record<string, unknown>[];
}

interface FakeDbTx extends DbTx {
  readonly insertCalls: number;
  readonly ownerQueries: number;
}

/**
 * Builds a fake DbTx whose `insert(...).values(...).onConflict...()
 * .returning()` / `.then()` chains consume the canned answers in order.
 * `select(...).from(t).where(...).limit(...)` chains likewise.
 */
function makeFakeTx(answers: CannedAnswer[]): FakeDbTx {
  const queue = [...answers];
  const state = { insertCalls: 0, ownerQueries: 0 };

  function nextRows(): Record<string, unknown>[] {
    const answer = queue.shift();
    if (answer === undefined) throw new Error("fake tx ran out of canned answers");
    if (answer.kind === "select-owner") state.ownerQueries += 1;
    return answer.rows;
  }

  function selectBuilder(): unknown {
    const builder = {
      from() {
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        return Promise.resolve(nextRows()).then(onFulfilled);
      },
    };
    return builder;
  }

  function insertBuilder(): unknown {
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
      returning() {
        state.insertCalls += 1;
        return Promise.resolve(nextRows());
      },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        state.insertCalls += 1;
        return Promise.resolve(nextRows()).then(onFulfilled);
      },
    };
    return builder;
  }

  return {
    select: selectBuilder,
    insert: insertBuilder,
    execute: () => Promise.resolve({ rows: [] }),
    get insertCalls() {
      return state.insertCalls;
    },
    get ownerQueries() {
      return state.ownerQueries;
    },
  } as unknown as FakeDbTx;
}

function workspaceRow(id: string, slug: string) {
  return { id, name: "Klik Studio", slug, status: "active" };
}

describe("requireId", () => {
  it("passes through the row id", () => {
    expect(requireId({ id: "row-1" }, "profile")).toBe("row-1");
  });

  it("throws a labeled error when the write produced no row", () => {
    expect(() => requireId(undefined, "membership")).toThrow(
      "membership insert returned no row",
    );
  });
});

describe("upsertProfile", () => {
  it("upserts keyed by auth_user_id so a retry keeps one profile row", async () => {
    // The ON CONFLICT DO UPDATE branch is exercised by feeding rows on both
    // calls; the repository must not throw or double-insert on retry.
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [{ id: "profile-1" }] },
      { kind: "insert-returning", rows: [{ id: "profile-1" }] },
    ]);
    const first = await upsertProfile(tx, {
      authUserId: "auth-42",
      displayName: "Ayu",
      phoneE164: null,
      now: NOW,
    });
    const second = await upsertProfile(tx, {
      authUserId: "auth-42",
      displayName: "Ayu Updated",
      phoneE164: "+6281100001111",
      now: NOW,
    });
    expect(first).toBe("profile-1");
    expect(second).toBe("profile-1");
    expect(tx.insertCalls).toBe(2);
  });
});

describe("createOrLoadWorkspace ownership boundary", () => {
  it("returns created=true when the workspace row inserts fresh", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [workspaceRow("ws-1", "klik")] },
    ]);
    const result = await createOrLoadWorkspace(tx, {
      name: "Klik Studio",
      slug: "klik",
      now: NOW,
      authUserId: "owner-A",
    });
    expect(result).toEqual({
      id: "ws-1",
      name: "Klik Studio",
      slug: "klik",
      status: "active",
      created: true,
    });
    expect(tx.ownerQueries).toBe(0);
  });

  it("hands the existing tenant to its authenticated owner with created=false", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [] },
      { kind: "select-workspace", rows: [workspaceRow("ws-2", "klik")] },
      { kind: "select-owner", rows: [{ authUserId: "owner-A" }] },
    ]);
    const result = await createOrLoadWorkspace(tx, {
      name: "Klik Studio",
      slug: "klik",
      now: NOW,
      authUserId: "owner-A",
    });
    expect(result).toMatchObject({ id: "ws-2", slug: "klik", created: false });
    expect(tx.ownerQueries).toBe(1);
  });

  it("P0 PRRT_kwDOT_C_FM6bh711: a different identity colliding on a taken slug gets WorkspaceSlugConflictError, not the foreign tenant", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [] },
      { kind: "select-workspace", rows: [workspaceRow("ws-2", "klik")] },
      { kind: "select-owner", rows: [{ authUserId: "owner-B" }] },
    ]);
    await expect(
      createOrLoadWorkspace(tx, {
        name: "Klik Studio",
        slug: "klik",
        now: NOW,
        authUserId: "intruder-9",
      }),
    ).rejects.toThrow(WorkspaceSlugConflictError);
    expect(tx.ownerQueries).toBe(1);
  });

  it("rejects when the existing workspace has NO active owner membership at all", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [] },
      { kind: "select-workspace", rows: [workspaceRow("ws-9", "ghost")] },
      { kind: "select-owner", rows: [] },
    ]);
    await expect(
      createOrLoadWorkspace(tx, {
        name: "Ghost",
        slug: "ghost",
        now: NOW,
        authUserId: "owner-C",
      }),
    ).rejects.toThrow(WorkspaceSlugConflictError);
  });

  it("raises when the vanished-slug race leaves nothing to load", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [] },
      { kind: "select-workspace", rows: [] },
    ]);
    await expect(
      createOrLoadWorkspace(tx, {
        name: "X",
        slug: "vanished",
        now: NOW,
        authUserId: "owner-D",
      }),
    ).rejects.toThrow("vanished mid-transaction");
  });

  it("error carries the contested slug for route-layer 409 mapping", async () => {
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [] },
      { kind: "select-workspace", rows: [workspaceRow("ws-2", "taken")] },
      { kind: "select-owner", rows: [{ authUserId: "owner-B" }] },
    ]);
    const error = await createOrLoadWorkspace(tx, {
      name: "Klik Studio",
      slug: "taken",
      now: NOW,
      authUserId: "intruder-9",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkspaceSlugConflictError);
    expect((error as WorkspaceSlugConflictError).slug).toBe("taken");
  });
});

describe("createActiveOwnerMembership retry semantics", () => {
  it("P1 PRRT_kwDOT_C_FM6bh713: returns the EXISTING active membership instead of inserting another", async () => {
    const tx = makeFakeTx([
      { kind: "select-membership", rows: [{ id: "mem-existing" }] },
    ]);
    const id = await createActiveOwnerMembership(tx, {
      workspaceId: "ws-2",
      authUserId: "owner-A",
      now: NOW,
    });
    expect(id).toBe("mem-existing");
    expect(tx.insertCalls).toBe(0);
  });

  it("inserts a fresh active owner when none exists yet", async () => {
    const tx = makeFakeTx([
      { kind: "select-membership", rows: [] },
      { kind: "insert-returning", rows: [{ id: "mem-new" }] },
    ]);
    const id = await createActiveOwnerMembership(tx, {
      workspaceId: "ws-3",
      authUserId: "owner-E",
      now: NOW,
    });
    expect(id).toBe("mem-new");
    expect(tx.insertCalls).toBe(1);
  });
});


describe("createActiveOwnerMembership fresh-onboarding fast path", () => {
  it("PRRT_kwDOT_C_FM6biuYn: skips the retry pre-SELECT when the workspace was created this transaction", async () => {
    // Fresh-onboarding path: `skipExistingLookup` must suppress the
    // membership SELECT entirely — only the insert may run. A canned
    // select-membership answer would go unconsumed and the fake would not
    // notice, so the empty queue proves no SELECT was issued: any SELECT
    // would shift the insert's canned answer and fail.
    const tx = makeFakeTx([
      { kind: "insert-returning", rows: [{ id: "mem-new" }] },
    ]);
    const id = await createActiveOwnerMembership(tx, {
      workspaceId: "ws-4",
      authUserId: "owner-F",
      now: NOW,
      skipExistingLookup: true,
    });
    expect(id).toBe("mem-new");
    expect(tx.insertCalls).toBe(1);
  });

  it("still performs the pre-SELECT on the default (retry) path", async () => {
    const tx = makeFakeTx([
      { kind: "select-membership", rows: [] },
      { kind: "insert-returning", rows: [{ id: "mem-new" }] },
    ]);
    await createActiveOwnerMembership(tx, {
      workspaceId: "ws-3",
      authUserId: "owner-E",
      now: NOW,
    });
    expect(tx.insertCalls).toBe(1);
  });
});