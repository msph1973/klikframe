import { describe, expect, it } from "vitest";
import {
  FIXED_WINDOW_MULTI_LUA,
  UPSTASH_SCRIPT_KEYS,
} from "../../../../lib/providers/upstash/fixed-window-lua";

/**
 * Regression contract for the shared multi-window Lua script (cubic
 * PRRT_kwDOT_C_FM6bh9ms, PRRT_kwDOT_C_FM6bh9m7). No Lua runtime exists in
 * the fast CI image, so the script's structural invariants are pinned here
 * and its observable behavior is exercised through the Upstash REST
 * adapter tests (`upstash-rate-limiter.test.ts`), which replay the exact
 * rows this script returns.
 */
describe("FIXED_WINDOW_MULTI_LUA script contract", () => {
  it("reports a full window as the unambiguous 0 sentinel, not used-1", () => {
    // The rollback path must insert the sentinel 0. The thread's literal
    // suggestion `used - 1` would equal `limit` for a blocked window —
    // indistinguishable from a granted call taking the last slot — so
    // blockage would become undetectable from the row alone. The 0 row is
    // safe because toResult() maps every 0 to "blocked, limit consumed"
    // and limit >= 1 means a granted row can never be 0.
    expect(FIXED_WINDOW_MULTI_LUA).toContain("table.insert(results, 0)");
    expect(FIXED_WINDOW_MULTI_LUA).toContain('redis.call("DECR", bucket)');
    expect(FIXED_WINDOW_MULTI_LUA).not.toMatch(/table\.insert\(results,\s*used\s*-\s*1\)/);
  });

  it("reads every input from ARGV triplets and never touches KEYS", () => {
    // The adapter invokes the script with numkeys=0; KEYS is empty, so any
    // KEYS[...] access would raise or silently read nothing. The loop must
    // walk (#ARGV - 1) / 3 key/limit/window triplets starting at ARGV[2].
    expect(UPSTASH_SCRIPT_KEYS).toBe(0);
    expect(FIXED_WINDOW_MULTI_LUA).not.toMatch(/\bKEYS\b/);
    expect(FIXED_WINDOW_MULTI_LUA).toContain("(#ARGV - 1) / 3");
    expect(FIXED_WINDOW_MULTI_LUA).toContain("ARGV[2 + i * 3]");
    expect(FIXED_WINDOW_MULTI_LUA).toContain("ARGV[3 + i * 3]");
    expect(FIXED_WINDOW_MULTI_LUA).toContain("ARGV[4 + i * 3]");
  });

  it("keeps one INCR per window with expiry set on first hit", () => {
    expect(FIXED_WINDOW_MULTI_LUA.match(/redis\.call\("INCR"/g)?.length).toBe(1);
    expect(FIXED_WINDOW_MULTI_LUA).toContain('if used == 1 then');
    expect(FIXED_WINDOW_MULTI_LUA).toContain('"PEXPIRE"');
    expect(FIXED_WINDOW_MULTI_LUA).toContain("window_seconds * 1000 + 1000");
  });
});
