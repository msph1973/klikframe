#!/usr/bin/env node
// File-size gate (AGENTS.md Quality Gates, TESTING.md §6, NFR-CQ-001).
// Source/test files target <=400 physical lines and hard-fail CI above 500,
// except an explicit non-glob allowlist entry with owner/reason.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REVIEW_TARGET_LINES = 400;
export const HARD_FAIL_LINES = 500;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", ".next", "coverage", "dist", "build"]);

export function countPhysicalLines(content) {
  if (content.length === 0) return 0;
  const normalized = content.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n") ? 1 : 0;
  return normalized.split("\n").length - trailingNewline;
}

export function isSourceOrTestFile(relativePath) {
  const ext = path.extname(relativePath);
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  const segments = relativePath.split(path.sep);
  return !segments.some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

export function evaluateFile(filePath, lineCount, allowlist) {
  if (allowlist.has(filePath)) {
    return { filePath, lineCount, severity: "ok" };
  }
  if (lineCount > HARD_FAIL_LINES) {
    return { filePath, lineCount, severity: "fail" };
  }
  if (lineCount > REVIEW_TARGET_LINES) {
    return { filePath, lineCount, severity: "review" };
  }
  return { filePath, lineCount, severity: "ok" };
}

export function loadAllowlist(allowlistPath) {
  if (!existsSync(allowlistPath)) {
    throw new Error(`file-size allowlist config not found at ${allowlistPath}`);
  }
  const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  if (!Array.isArray(raw.entries)) {
    throw new Error("file-size allowlist config must have an 'entries' array");
  }
  const paths = new Set();
  for (const entry of raw.entries) {
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new Error("file-size allowlist entries require a non-empty 'path'");
    }
    if (entry.path.includes("*") || entry.path.includes("?")) {
      throw new Error(`file-size allowlist path must be explicit, no globs: ${entry.path}`);
    }
    if (typeof entry.owner !== "string" || entry.owner.length === 0) {
      throw new Error(`file-size allowlist entry "${entry.path}" requires an 'owner'`);
    }
    if (typeof entry.reason !== "string" || entry.reason.length === 0) {
      throw new Error(`file-size allowlist entry "${entry.path}" requires a 'reason'`);
    }
    paths.add(entry.path);
  }
  return paths;
}

function listGitTrackedFiles(cwd) {
  const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

/** @param {{ cwd: string, allowlistPath: string }} options */
export function checkRepository({ cwd, allowlistPath }) {
  const allowlist = loadAllowlist(allowlistPath);
  const files = listGitTrackedFiles(cwd).filter(isSourceOrTestFile);
  return files.map((relativePath) => {
    const content = readFileSync(path.join(cwd, relativePath), "utf8");
    const lineCount = countPhysicalLines(content);
    return evaluateFile(relativePath, lineCount, allowlist);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cwd = process.cwd();
  const allowlistPath = path.join(cwd, "config", "file-size-allowlist.json");
  const results = checkRepository({ cwd, allowlistPath });
  const reviews = results.filter((r) => r.severity === "review");
  const failures = results.filter((r) => r.severity === "fail");

  for (const r of reviews) {
    console.warn(`[review] ${r.filePath}: ${r.lineCount} lines (target <= ${REVIEW_TARGET_LINES}; record a split reason when touched)`);
  }
  for (const r of failures) {
    console.error(`[fail] ${r.filePath}: ${r.lineCount} lines exceeds hard limit ${HARD_FAIL_LINES} without an allowlist entry`);
  }
  if (failures.length > 0) {
    console.error(`\ncheck:file-size failed: ${failures.length} file(s) exceed ${HARD_FAIL_LINES} lines.`);
    process.exit(1);
  }
  console.log(`check:file-size passed: ${results.length} source/test file(s) scanned, ${reviews.length} at/above review target.`);
}
