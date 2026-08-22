import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanContent, scanRepository } from "../../../scripts/secret-scan.mjs";

describe("scanContent", () => {
  it("flags a compound identifier like AWS_SECRET_ACCESS_KEY (code-point, not \\b, boundary)", () => {
    const findings = scanContent(
      "config.ts",
      'export const AWS_SECRET_ACCESS_KEY = "ACVDby7jojxldyCEPqASLBXVca0b9lBR0sjJvPHs";',
    );
    expect(findings.some((f) => f.rule === "generic-secret-assignment")).toBe(true);
  });

  it("flags a compound two-word token like NEON_AUTH_COOKIE_SECRET", () => {
    const findings = scanContent(
      "config.ts",
      'const NEON_AUTH_COOKIE_SECRET = "abcdefghijklmnopqrstuvwxyz123456";',
    );
    expect(findings.some((f) => f.rule === "generic-secret-assignment")).toBe(true);
  });

  it("classifies .env and .env.<suffix> basenames as dotenv regardless of extname", () => {
    const body = 'AWS_SECRET_ACCESS_KEY="ACVDby7jojxldyCEPqASLBXVca0b9lBR0sjJvPHs"';
    expect(scanContent(".env", body).length).toBeGreaterThan(0);
    expect(scanContent(".env.s3", body).length).toBeGreaterThan(0);
  });

  it("does not flag an unrelated uppercase identifier", () => {
    const findings = scanContent("config.ts", 'const MAX_RETRY_COUNT = "abcdefghijklmnopqrstuvwxyz";');
    expect(findings).toHaveLength(0);
  });

  it("does not flag documentation placeholders like <random-32-plus-bytes>", () => {
    const findings = scanContent("DEPLOYMENT.md", "CRON_SECRET=<random-32-plus-bytes>");
    // DEPLOYMENT.md is not a source/config extension and not a dotenv
    // basename, so the assignment rule never applies to it.
    expect(findings).toHaveLength(0);
  });

  it("does not swallow the next line's identifier as this line's blank value", () => {
    // .env.example-style template: every optional key is blank.
    const body = "AWS_ACCESS_KEY_ID=\nAWS_SECRET_ACCESS_KEY=\nAWS_REGION=ap-southeast-1\n";
    expect(scanContent(".env.example", body)).toHaveLength(0);
  });

  it("does not flag synthetic secret-shaped fixtures in the exact exempted test file", () => {
    const findings = scanContent(
      "tests/unit/scripts/secret-scan.test.ts",
      'export const AWS_SECRET_ACCESS_KEY = "ACVDby7jojxldyCEPqASLBXVca0b9lBR0sjJvPHs";',
    );
    expect(findings).toHaveLength(0);
  });

  it("still flags a real secret-shaped assignment under a different tests/ path", () => {
    const findings = scanContent(
      "tests/fixtures/leaked.ts",
      'export const AWS_SECRET_ACCESS_KEY = "ACVDby7jojxldyCEPqASLBXVca0b9lBR0sjJvPHs";',
    );
    expect(findings.some((f) => f.rule === "generic-secret-assignment")).toBe(true);
  });

  it("flags a quoted JSON key like \"SECRET\": \"...\"", () => {
    const findings = scanContent(
      "config.json",
      '{ "SECRET": "abcdefghijklmnopqrstuvwxyz123456" }',
    );
    expect(findings.some((f) => f.rule === "generic-secret-assignment")).toBe(true);
  });
});

describe("scanRepository", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "klikframe-secret-scan-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  it("fails closed on a tracked file above the size cap instead of skipping it silently", () => {
    writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(600_000));
    execFileSync("git", ["add", "-A"], { cwd: tmpDir });
    const findings = scanRepository(tmpDir);
    expect(findings.some((f) => f.rule === "file-too-large-to-scan")).toBe(true);
  });

  it("scans untracked-but-not-ignored files, not only committed ones", () => {
    writeFileSync(
      path.join(tmpDir, "config.ts"),
      'export const AWS_SECRET_ACCESS_KEY = "ACVDby7jojxldyCEPqASLBXVca0b9lBR0sjJvPHs";',
    );
    // Deliberately left untracked (no `git add`).
    const findings = scanRepository(tmpDir);
    expect(findings.some((f) => f.rule === "generic-secret-assignment")).toBe(true);
  });
});
