#!/usr/bin/env node
// Static/documentation validation gate (TESTING.md §8, §6 CI order).
// Validates local links/anchors, duplicate/undefined requirement IDs,
// Mermaid diagram parse, JSON example parse, table column shape,
// unterminated fences, forbidden/legacy environment vocabulary, and the
// file-size allowlist shape. Fails the CI gate (non-zero exit) on any
// finding.
//
// Known gap vs. TESTING.md §8: full route/status/role/environment
// *cross-document* vocabulary consistency and end-to-end traceability
// completeness (beyond requirement-ID reference validation) are not yet
// automated — TESTING.md §8 itself anticipates this ("Sampai script
// tersedia, review checklist yang sama wajib dijalankan manual") and
// requires it be run manually and recorded in the handoff until a later
// wave extends this script.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLocalLinks,
  checkJsonFences,
  checkMermaidFences,
  checkTableShapes,
  checkUnterminatedFences,
  checkRequirementIds,
  checkForbiddenEnvVars,
  checkFileSizeAllowlistShape,
} from "./docs/rules.mjs";

export function listTrackedMarkdownFiles(cwd) {
  const output = execFileSync("git", ["ls-files", "*.md"], { cwd, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

export function runDocsCheck(cwd) {
  const files = listTrackedMarkdownFiles(cwd);
  const ctx = { files, cwd };
  const allowlistPath = path.join(cwd, "config", "file-size-allowlist.json");

  const sections = [
    ["local links/anchors", checkLocalLinks(ctx)],
    ["JSON example fences", checkJsonFences(ctx)],
    ["Mermaid diagrams", checkMermaidFences(ctx)],
    ["table column shape", checkTableShapes(ctx)],
    ["unterminated fenced code blocks", checkUnterminatedFences(ctx)],
    ["requirement ID duplicates/undefined refs", checkRequirementIds(ctx)],
    ["forbidden/legacy env vocabulary", checkForbiddenEnvVars(ctx)],
    ["file-size allowlist shape", checkFileSizeAllowlistShape(allowlistPath)],
  ];

  return { files, sections };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cwd = process.cwd();
  const { files, sections } = runDocsCheck(cwd);
  let totalFindings = 0;
  for (const [name, findings] of sections) {
    if (findings.length === 0) continue;
    totalFindings += findings.length;
    console.error(`\n[docs:check] ${name}: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  - ${finding}`);
  }
  if (totalFindings > 0) {
    console.error(`\ndocs:check failed: ${totalFindings} finding(s) across ${files.length} Markdown file(s).`);
    process.exit(1);
  }
  console.log(`docs:check passed: ${files.length} Markdown file(s) validated, 0 findings.`);
}
