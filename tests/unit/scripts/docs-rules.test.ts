import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRequirementIds,
  checkForbiddenEnvVars,
  checkUnterminatedFences,
  checkFileSizeAllowlistShape,
} from "../../../scripts/docs/rules.mjs";

describe("checkRequirementIds", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "klikframe-docs-rules-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not self-authorize a typo'd ID in the canonical file's own traceability table", () => {
    writeFileSync(
      path.join(cwd, "PRODUCT_REQUIREMENTS.md"),
      [
        "### KF-ONB-001 — Onboarding",
        "",
        "## 11. Initial Traceability Matrix",
        "",
        "| ID | Note |",
        "|---|---|",
        "| KF-ONB-002 | typo, should be KF-ONB-001 |",
        "",
      ].join("\n"),
    );
    const findings = checkRequirementIds({ files: ["PRODUCT_REQUIREMENTS.md"], cwd });
    expect(findings.some((f) => f.includes("KF-ONB-002"))).toBe(true);
  });

  it("treats an NFR table row as a valid definition, not just KF headings", () => {
    writeFileSync(
      path.join(cwd, "PRODUCT_REQUIREMENTS.md"),
      ["## 8. Non-Functional Requirements", "", "| ID | Area |", "|---|---|", "| NFR-SEC-001 | Security |", ""].join(
        "\n",
      ),
    );
    writeFileSync(path.join(cwd, "OTHER.md"), "References NFR-SEC-001 elsewhere.\n");
    const findings = checkRequirementIds({ files: ["PRODUCT_REQUIREMENTS.md", "OTHER.md"], cwd });
    expect(findings).toHaveLength(0);
  });

  it("does not accept a misspelled NFR ID from outside the Non-Functional Requirements section as a definition", () => {
    writeFileSync(
      path.join(cwd, "PRODUCT_REQUIREMENTS.md"),
      [
        "## 8. Non-Functional Requirements",
        "",
        "| ID | Area |",
        "|---|---|",
        "| NFR-SEC-001 | Security |",
        "",
        "## 11. Initial Traceability Matrix",
        "",
        "| ID | Note |",
        "|---|---|",
        "| NFR-SEC-002 | typo, should be NFR-SEC-001 |",
        "",
      ].join("\n"),
    );
    const findings = checkRequirementIds({ files: ["PRODUCT_REQUIREMENTS.md"], cwd });
    expect(findings.some((f) => f.includes("NFR-SEC-002"))).toBe(true);
  });
});

describe("checkForbiddenEnvVars", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "klikframe-docs-rules-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not suppress a real violation just because 'skip' appears elsewhere in the sentence", () => {
    writeFileSync(
      path.join(cwd, "DOC.md"),
      "Set QSTASH_TOKEN in the dashboard. Skip the optional retry step.\n",
    );
    const findings = checkForbiddenEnvVars({ files: ["DOC.md"], cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("DOC.md:1");
  });

  it("still allows a negation in the same sentence as a long comma-separated list", () => {
    writeFileSync(
      path.join(cwd, "DOC.md"),
      "`NEXTAUTH_*`, `R2_*`, `MIDTRANS_*`, dan worker variables tidak boleh ada pada MVP.\n",
    );
    const findings = checkForbiddenEnvVars({ files: ["DOC.md"], cwd });
    expect(findings).toHaveLength(0);
  });
});

describe("checkUnterminatedFences", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "klikframe-docs-rules-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("flags an unterminated fenced block", () => {
    writeFileSync(path.join(cwd, "DOC.md"), ["Intro", "```json", "{}", ""].join("\n"));
    const findings = checkUnterminatedFences({ files: ["DOC.md"], cwd });
    expect(findings).toHaveLength(1);
  });

  it("accepts a longer closer than the opener (3-backtick open, 4-backtick close)", () => {
    writeFileSync(path.join(cwd, "DOC.md"), ["```json", "{}", "````", ""].join("\n"));
    const findings = checkUnterminatedFences({ files: ["DOC.md"], cwd });
    expect(findings).toHaveLength(0);
  });
});

describe("checkFileSizeAllowlistShape", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "klikframe-docs-rules-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports a friendly finding instead of crashing on JSON null", () => {
    const allowlistPath = path.join(cwd, "allowlist.json");
    writeFileSync(allowlistPath, "null");
    expect(() => checkFileSizeAllowlistShape(allowlistPath)).not.toThrow();
    expect(checkFileSizeAllowlistShape(allowlistPath)).toHaveLength(1);
  });
});
