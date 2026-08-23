import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRouteVocabulary,
  checkStatusVocabulary,
  checkRoleVocabulary,
  checkTraceabilityCompleteness,
  checkAblyScopeConsistency,
} from "../../../scripts/docs/section8-rules.mjs";

// Minimal canonical corpus mirroring the real documents' relevant parts,
// so the rules under test have their expected inputs.
function writeCanonicalCorpus(cwd: string): void {
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    path.join(cwd, "API_SPEC.md"),
    [
      "# Spesifikasi API",
      "",
      "### `POST /onboarding`",
      "",
      "| Method/path | Fungsi | Success |",
      "|---|---|---|",
      "| `GET /me` | Session | `200` |",
      "",
      "### `GET /health`",
      "",
      "Portal scopes: `contract:read`, `invoice:proof:create`.",
      "Channel: `workspace:<workspace_id>` dan `portal:<portal_token_id>:<resource_type>:<resource_id>`.",
    ].join("\n"),
  );
  writeFileSync(
    path.join(cwd, "DATABASE_SCHEMA.md"),
    [
      "# Skema Database",
      "",
      "| status | enum | `active`, `deletion_pending`, `suspended`, `deleted` |",
      "| status | enum | `draft`,`confirmed`,`in_progress`,`completed`,`cancelled` |",
      "| role | enum | MVP hanya `owner` |",
    ].join("\n"),
  );
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "klikframe-section8-"));
  writeCanonicalCorpus(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("checkRouteVocabulary", () => {
  it("accepts a route declared in API_SPEC (bare and /api/v1-qualified)", () => {
    writeFileSync(path.join(cwd, "OTHER.md"), "See `POST /onboarding` or `GET /api/v1/me`.\n");
    expect(checkRouteVocabulary({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("accepts an auth-provider proxy route outside /api/v1", () => {
    writeFileSync(path.join(cwd, "OTHER.md"), "Proxy target: `GET /api/auth/get-session`.\n");
    expect(checkRouteVocabulary({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("rejects a route that API_SPEC does not declare", () => {
    writeFileSync(path.join(cwd, "OTHER.md"), "`POST /onboarding-v2` exists.\n");
    const findings = checkRouteVocabulary({ files: ["OTHER.md"], cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("undeclared route");
  });
});

describe("checkStatusVocabulary", () => {
  it("accepts canonical status tokens near a status mention", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Workspace `status` harus `active` sebelum order masuk state `confirmed`.\n",
    );
    expect(checkStatusVocabulary({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("rejects an unknown status token near a status mention", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Order `status` berpindah ke `shipped` setelah dikirim.\n",
    );
    const findings = checkStatusVocabulary({ files: ["OTHER.md"], cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("`shipped`");
  });
});

describe("checkRoleVocabulary", () => {
  it("accepts admin/assistant inside an out-of-scope section", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      ["## 5.2 Di Luar Cakupan MVP", "", "- role `admin` atau `assistant`.", ""].join("\n"),
    );
    expect(checkRoleVocabulary({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("accepts admin/assistant with an explicit Post-MVP marker on the line", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Role `admin`/`assistant` adalah Post-MVP; tidak ada pada MVP.\n",
    );
    expect(checkRoleVocabulary({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("rejects admin described as an active MVP role", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Role `admin` dapat mengundang anggota tim pada MVP.\n",
    );
    const findings = checkRoleVocabulary({ files: ["OTHER.md"], cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("`admin`");
  });
});

describe("checkTraceabilityCompleteness", () => {
  function writeRoadmap(): void {
    writeFileSync(
      path.join(cwd, "ROADMAP.md"),
      ["## Fase 0 — Foundation", "", "## Fase 1 — CRM", "", "## Fase 2 — Kontrak", ""].join("\n"),
    );
  }

  function writeRequirements(rows: string[]): void {
    writeFileSync(
      path.join(cwd, "PRODUCT_REQUIREMENTS.md"),
      [
        "# PR",
        "",
        "## 11. Initial Traceability Matrix",
        "",
        "| ID | Data contract | API/use case | Security control | Test suite | Roadmap |",
        "|---|---|---|---|---|---|",
        ...rows,
        "",
      ].join("\n"),
    );
  }

  function writeTesting(rows: string[]): void {
    writeFileSync(
      path.join(cwd, "TESTING.md"),
      [
        "# Testing",
        "",
        "## 7. Traceability Matrix Final",
        "",
        "| Requirement | Data contract | API/use case | Security control | Test suite | Roadmap |",
        "|---|---|---|---|---|---|",
        ...rows,
        "",
      ].join("\n"),
    );
  }

  function onboardingRow(phase: string): string {
    return `| KF-ONB-001 | profiles/workspaces | \`POST /onboarding\` | Session | Concurrency tests | ${phase} |`;
  }

  function contractRow(phase: string): string {
    return "| KF-CON-001 | snapshot | publish | token | sign tests | " + phase + " |";
  }

  beforeEach(() => {
    writeRoadmap();
  });

  it("passes when both matrices agree and every phase exists in the roadmap", () => {
    writeRequirements([onboardingRow("Phase 0"), contractRow("Phase 2")]);
    writeTesting([onboardingRow("Phase 0"), contractRow("Phase 2")]);
    expect(checkTraceabilityCompleteness({ files: [], cwd })).toHaveLength(0);
  });

  it("flags a requirement present in one matrix but missing from the other", () => {
    writeRequirements([onboardingRow("Phase 0")]);
    writeTesting([onboardingRow("Phase 0"), contractRow("Phase 2")]);
    const findings = checkTraceabilityCompleteness({ files: [], cwd });
    expect(findings.some((f) => f.includes("KF-CON-001"))).toBe(true);
  });

  it("flags contradictory phase mappings between the two matrices", () => {
    writeRequirements([onboardingRow("Phase 0")]);
    writeTesting([onboardingRow("Phase 1")]);
    const findings = checkTraceabilityCompleteness({ files: [], cwd });
    expect(findings.some((f) => f.includes("contradiction"))).toBe(true);
  });

  it("flags a matrix phase that has no matching roadmap Fase heading", () => {
    writeRequirements([onboardingRow("Phase 9")]);
    writeTesting([onboardingRow("Phase 9")]);
    const findings = checkTraceabilityCompleteness({ files: [], cwd });
    expect(findings.some((f) => f.includes("Fase 9"))).toBe(true);
  });

  it("rejects a malformed phase cell instead of silently skipping the row", () => {
    writeRequirements(["| KF-ONB-001 | profiles/workspaces | `POST /onboarding` | Session | Tests | TBD |"]);
    writeTesting([onboardingRow("Phase 0")]);
    const findings = checkTraceabilityCompleteness({ files: [], cwd });
    expect(findings.some((f) => f.includes('invalid roadmap cell "TBD"'))).toBe(true);
  });
});

describe("checkAblyScopeConsistency", () => {
  it("accepts canonical scopes, channels, event pairings, and server-only statements", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      [
        "Scope portal: `contract:read`.",
        "Channel owner: `workspace:<workspace_id>`.",
        'Envelope: `"event_type": "payment.recorded"` dengan `"type": "invoice"`.',
        "`ABLY_API_KEY` tidak pernah dikirim ke browser; browser tidak menerima publish capability.",
      ].join("\n"),
    );
    expect(checkAblyScopeConsistency({ files: ["OTHER.md"], cwd })).toHaveLength(0);
  });

  it("rejects an unknown portal action scope", () => {
    writeFileSync(path.join(cwd, "OTHER.md"), "Scope: `album:delete`.\n");
    const findings = checkAblyScopeConsistency({ files: ["OTHER.md"], cwd });
    expect(findings.some((f) => f.includes("`album:delete`"))).toBe(true);
  });

  it("rejects a non-canonical channel shape", () => {
    writeFileSync(path.join(cwd, "OTHER.md"), "Channel: `workspace_of_owners`.\n");
    const findings = checkAblyScopeConsistency({ files: ["OTHER.md"], cwd });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("rejects an event paired with the wrong resource type in an envelope example", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      'Contoh salah: `"event_type": "contract.signed"` dengan `"type": "invoice"`.\n',
    );
    const findings = checkAblyScopeConsistency({ files: ["OTHER.md"], cwd });
    expect(findings.some((f) => f.includes("canonical mapping requires"))).toBe(true);
  });

  it("rejects an affirmative statement exposing ABLY_API_KEY to the browser", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Server mengirim ABLY_API_KEY ke browser saat connect.\n",
    );
    const findings = checkAblyScopeConsistency({ files: ["OTHER.md"], cwd });
    expect(findings.some((f) => f.includes("ABLY_API_KEY"))).toBe(true);
  });

  it("rejects granting a publish capability to the browser", () => {
    writeFileSync(
      path.join(cwd, "OTHER.md"),
      "Browser menerima publish capability untuk channel workspace.\n",
    );
    const findings = checkAblyScopeConsistency({ files: ["OTHER.md"], cwd });
    expect(findings.some((f) => f.includes("publish capability"))).toBe(true);
  });
});
