#!/usr/bin/env node
// Baseline secret scan (SECURITY.md §9, §11; TOOLING.md Pre-Git Checklist).
// Lightweight regex scanner over tracked + untracked-but-not-ignored files
// (run after `git init`, before the first commit, and again in CI). This is
// a defense-in-depth gate, not a replacement for GitHub secret scanning/push
// protection, which SHOULD also be enabled on the repository.

import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SCANNED_BYTES = 500_000;

const HIGH_CONFIDENCE_RULES = [
  { name: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key-block", pattern: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/ },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "stripe-secret-key", pattern: /sk_(live|test)_[0-9a-zA-Z]{16,}/ },
];

// SECRET/TOKEN/etc. also appear as a segment of a compound name such as
// AWS_SECRET_ACCESS_KEY or NEON_AUTH_COOKIE_SECRET; matching must split on
// `_` rather than relying on `\b` (which does not fire between two `_`-
// joined word characters).
const SENSITIVE_TOKENS = new Set(["SECRET", "PASSWORD", "TOKEN", "API_KEY", "PRIVATE_KEY", "ACCESS_KEY"]);
// Horizontal whitespace only around the delimiter/value: `\s` would also
// match the newline after a *blank* `KEY=` assignment (as in .env.example)
// and let the match continue into the next line's identifier as if it
// were this key's value. An optional quote before the delimiter handles
// quoted JSON keys like `"SECRET": "..."`.
const IDENTIFIER_ASSIGNMENT_PATTERN =
  /\b([A-Z][A-Z0-9_]*)["']?[ \t]*[:=][ \t]*["']?([A-Za-z0-9+/=_-]{16,})["']?/g;

// Applied only to source/config/dotenv files (not documentation), where a
// KEY=VALUE or "KEY": "VALUE" assignment with a long opaque value is
// unambiguous.
const ASSIGNMENT_RULE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml"]);

// This exact file legitimately contains synthetic, clearly-fake
// secret-shaped strings to exercise this very rule. Scoped to the exact
// path (not a `tests/` prefix) so a real secret committed anywhere else
// under tests/ is still caught; high-confidence provider-specific formats
// (AWS/GitHub/Slack/...) still apply even to this file.
const ASSIGNMENT_RULE_EXCLUDED_FILES = new Set(["tests/unit/scripts/secret-scan.test.ts"]);

function isDotenvFile(relativePath) {
  const base = path.basename(relativePath);
  return base === ".env" || base.startsWith(".env.");
}

function containsSensitiveToken(identifier) {
  const segments = identifier.split("_");
  for (let i = 0; i < segments.length; i += 1) {
    if (SENSITIVE_TOKENS.has(segments[i])) return true;
    if (i + 1 < segments.length && SENSITIVE_TOKENS.has(`${segments[i]}_${segments[i + 1]}`)) return true;
  }
  return false;
}

/** Tracked files plus untracked files that are not gitignored. */
export function listScannableFiles(cwd) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

export function scanContent(relativePath, content) {
  const findings = [];
  for (const rule of HIGH_CONFIDENCE_RULES) {
    const match = rule.pattern.exec(content);
    if (match) findings.push({ file: relativePath, rule: rule.name, sample: redact(match[0]) });
  }
  const isExcludedFromAssignmentRule = ASSIGNMENT_RULE_EXCLUDED_FILES.has(relativePath);
  if (
    !isExcludedFromAssignmentRule &&
    (ASSIGNMENT_RULE_EXTENSIONS.has(path.extname(relativePath)) || isDotenvFile(relativePath))
  ) {
    IDENTIFIER_ASSIGNMENT_PATTERN.lastIndex = 0;
    let match;
    while ((match = IDENTIFIER_ASSIGNMENT_PATTERN.exec(content)) !== null) {
      if (!containsSensitiveToken(match[1])) continue;
      findings.push({ file: relativePath, rule: "generic-secret-assignment", sample: redact(match[0]) });
    }
  }
  return findings;
}

export function redact(value) {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

export function scanRepository(cwd) {
  const files = listScannableFiles(cwd);
  const findings = [];
  for (const relativePath of files) {
    const absolute = path.join(cwd, relativePath);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (stats.size > MAX_SCANNED_BYTES) {
      // Fail closed: an unscanned file could hide a secret. Splitting/
      // streaming large files is unnecessary until one is actually
      // committed; until then this forces a human decision instead of
      // silently treating "skipped" as "clean".
      findings.push({
        file: relativePath,
        rule: "file-too-large-to-scan",
        sample: `${String(stats.size)} bytes > ${String(MAX_SCANNED_BYTES)} byte cap`,
      });
      continue;
    }
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
  console.log("secret:scan passed: no known secret patterns found in scannable files.");
}
