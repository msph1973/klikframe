import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  countPhysicalLines,
  evaluateFile,
  loadAllowlist,
  REVIEW_TARGET_LINES,
  HARD_FAIL_LINES,
} from "../../scripts/check-file-size.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
// Invoke the pinned local binaries directly rather than `npx`, which is
// version-ambiguous (it can resolve or install a global/latest binary
// when node_modules is absent) and would undermine this PR's exact-pin
// goal for a gate that specifically proves version-sensitive behavior.
const BIN_DIR = path.join(REPO_ROOT, "node_modules", ".bin");

describe("NFR-CQ-001 negative fixtures: forbidden any", () => {
  it("fails `tsc --noEmit --strict` on an implicit any parameter (TS7006)", async () => {
    await expect(
      execFileAsync(
        path.join(BIN_DIR, "tsc"),
        ["--noEmit", "-p", "tests/fixtures/negative/tsconfig.json"],
        { cwd: REPO_ROOT },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("implicitly has an 'any' type") as unknown as string,
    });
  });

  it("fails ESLint on explicit `any` and unsafe member access", async () => {
    await expect(
      execFileAsync(
        path.join(BIN_DIR, "eslint"),
        ["--no-ignore", "tests/fixtures/negative/explicit-any.fixture.ts"],
        { cwd: REPO_ROOT },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("@typescript-eslint/no-explicit-any") as unknown as string,
    });
  });
});

describe("NFR-CQ-001 negative fixtures: file-size hard gate", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "klikframe-file-size-"));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a file at the review target", () => {
    const content = "const line = 1;\n".repeat(REVIEW_TARGET_LINES);
    expect(evaluateFile("ok.ts", countPhysicalLines(content), new Set()).severity).toBe("ok");
  });

  it("warns (but does not fail) between 401 and 500 lines", () => {
    const content = "const line = 1;\n".repeat(REVIEW_TARGET_LINES + 50);
    const result = evaluateFile("review.ts", countPhysicalLines(content), new Set());
    expect(result.severity).toBe("review");
  });

  it("fails a generated file above the hard limit", () => {
    const filePath = path.join(tmpDir, "oversize.ts");
    writeFileSync(filePath, "const line = 1;\n".repeat(HARD_FAIL_LINES + 1));
    const persisted = readFileSync(filePath, "utf8");
    const result = evaluateFile(filePath, countPhysicalLines(persisted), new Set());
    expect(result.severity).toBe("fail");
    expect(result.lineCount).toBeGreaterThan(HARD_FAIL_LINES);
  });

  it("allows an oversize file only via an explicit allowlist entry", () => {
    const content = "const line = 1;\n".repeat(HARD_FAIL_LINES + 1);
    const allowlist = new Set(["generated/large.ts"]);
    expect(evaluateFile("generated/large.ts", countPhysicalLines(content), allowlist).severity).toBe(
      "ok",
    );
    expect(evaluateFile("other/large.ts", countPhysicalLines(content), allowlist).severity).toBe(
      "fail",
    );
  });

  it("rejects an allowlist config that uses a glob path", () => {
    const allowlistPath = path.join(tmpDir, "allowlist.json");
    writeFileSync(
      allowlistPath,
      JSON.stringify({ entries: [{ path: "generated/**", owner: "x", reason: "y" }] }),
    );
    expect(() => loadAllowlist(allowlistPath)).toThrow(/explicit/);
  });

});
