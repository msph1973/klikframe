#!/usr/bin/env node
// Baseline secret scan (SECURITY.md §9, §11; TOOLING.md Pre-Git Checklist).
// Lightweight regex scanner over git-tracked files. This is a defense-in-depth
// local/CI gate, not a replacement for GitHub secret scanning/push protection,
// which SHOULD also be enabled on the repository (see PR report).

import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SCANNED_BYTES = 500_000;
const SKIP_EXACT_FILES = new Set(["package-lock.json"]);

const HIGH_CONFIDENCE_RULES = [
  { name: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key-block", pattern: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/ },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "stripe-secret-key", pattern: /sk_(live|test)_[0-9a-zA-Z]{16,}/ },
];

// Applied only to source/config files (not documentation), where a KEY=VALUE
// or "KEY": "VALUE" assignment with a long opaque value is unambiguous.
const ASSIGNMENT_RULE = {
  name: "generic-secret-assignment",
  pattern: /\b(SECRET|PASSWORD|PRIVATE_KEY|API_KEY|TOKEN)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}["']?/,
  extensions: new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".env"]),
};

export function listTrackedFiles(cwd) {
  const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

export function scanContent(relativePath, content) {
  const findings = [];
  for (const rule of HIGH_CONFIDENCE_RULES) {
    const match = rule.pattern.exec(content);
    if (match) findings.push({ file: relativePath, rule: rule.name, sample: redact(match[0]) });
  }
  const ext = path.extname(relativePath);
  if (ASSIGNMENT_RULE.extensions.has(ext)) {
    const match = ASSIGNMENT_RULE.pattern.exec(content);
    if (match) findings.push({ file: relativePath, rule: ASSIGNMENT_RULE.name, sample: redact(match[0]) });
  }
  return findings;
}

export function redact(value) {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

export function scanRepository(cwd) {
  const files = listTrackedFiles(cwd);
  const findings = [];
  for (const relativePath of files) {
    if (SKIP_EXACT_FILES.has(relativePath)) continue;
    const absolute = path.join(cwd, relativePath);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) continue;
    let content;
    try {
      content = readFileSync(absolute, "utf8");
    } catch {
      continue; // binary or unreadable file
    }
    findings.push(...scanContent(relativePath, content));
  }
  return findings;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cwd = process.cwd();
  const findings = scanRepository(cwd);
  if (findings.length > 0) {
    console.error(`secret:scan failed: ${findings.length} potential secret(s) found.`);
    for (const finding of findings) {
      console.error(`  - ${finding.file}: ${finding.rule} (${finding.sample})`);
    }
    process.exit(1);
  }
  console.log("secret:scan passed: no known secret patterns found in tracked files.");
}
