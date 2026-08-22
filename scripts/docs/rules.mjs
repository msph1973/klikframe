import { readFileSync } from "node:fs";
import path from "node:path";
import { parseHeadings, parseLocalLinks, parseFencedBlocks, parseTables } from "./markdown.mjs";

const MERMAID_DIAGRAM_KEYWORDS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram-v2",
  "stateDiagram",
  "erDiagram",
  "gantt",
  "pie",
  "journey",
  "mindmap",
  "gitGraph",
];

const BRACKET_PAIRS = { "(": ")", "[": "]", "{": "}" };
const BRACKET_CLOSERS = new Set(Object.values(BRACKET_PAIRS));

const REQUIREMENT_ID_PATTERN = /\b((?:KF|NFR)-[A-Z]+-\d{3})\b/g;
const REQUIREMENT_HEADING_PATTERN = /^#{2,4}\s+`?(KF-[A-Z]+-\d{3})`?\s+—/;
const REQUIREMENT_CANONICAL_FILE = "PRODUCT_REQUIREMENTS.md";

const FORBIDDEN_ENV_PATTERNS = [
  /NEXTAUTH_[A-Z_]*/,
  /GOOGLE_CLIENT_[A-Z_]*/,
  /\bS3_PUBLIC_URL\b/,
  /\bR2_[A-Z_]*/,
  /MIDTRANS_[A-Z_]*/,
  /WHATSAPP_[A-Z_]*/,
  /QSTASH_[A-Z_]*/,
  /NEXT_PUBLIC_ABLY_[A-Z_]*/,
];
const NEGATION_MARKERS = ["tidak", "dilarang", "skip", "bukan", "diganti"];

/** @param {{ files: string[], cwd: string }} ctx */
export function checkLocalLinks({ files, cwd }) {
  const headingCache = new Map();
  const headingsOf = (relativePath) => {
    if (!headingCache.has(relativePath)) {
      let content;
      try {
        content = readFileSync(path.join(cwd, relativePath), "utf8");
      } catch {
        headingCache.set(relativePath, null);
        return null;
      }
      headingCache.set(relativePath, new Set(parseHeadings(content).map((h) => h.slug)));
    }
    return headingCache.get(relativePath);
  };

  const findings = [];
  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    const base = path.dirname(file);
    for (const link of parseLocalLinks(content)) {
      const [rawPath, anchor] = splitTarget(link.target);
      const resolved = rawPath === "" ? file : path.normalize(path.join(base, rawPath));
      const slugs = headingsOf(resolved);
      if (slugs === null) {
        findings.push(`${file}:${link.line} broken link target "${link.target}" -> missing file ${resolved}`);
        continue;
      }
      if (anchor && !slugs.has(anchor)) {
        findings.push(`${file}:${link.line} broken anchor "#${anchor}" in "${link.target}" (resolved ${resolved})`);
      }
    }
  }
  return findings;
}

function splitTarget(target) {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) return [target, null];
  return [target.slice(0, hashIndex), target.slice(hashIndex + 1)];
}

/** @param {{ files: string[], cwd: string }} ctx */
export function checkJsonFences({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    for (const block of parseFencedBlocks(content, "json")) {
      try {
        JSON.parse(block.code);
      } catch (error) {
        findings.push(`${file}:${block.line} invalid JSON fence: ${errorMessage(error)}`);
      }
    }
  }
  return findings;
}

/** @param {{ files: string[], cwd: string }} ctx */
export function checkMermaidFences({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    for (const block of parseFencedBlocks(content, "mermaid")) {
      const result = validateMermaidBlock(block.code);
      if (!result.valid) {
        findings.push(`${file}:${block.line} invalid Mermaid block: ${result.reason}`);
      }
    }
  }
  return findings;
}

export function validateMermaidBlock(code) {
  const trimmed = code.trim();
  const firstLine = (trimmed.split("\n")[0] ?? "").trim();
  const firstToken = firstLine.split(/\s+/)[0] ?? "";
  if (!MERMAID_DIAGRAM_KEYWORDS.includes(firstToken)) {
    return { valid: false, reason: `unknown or missing diagram type in "${firstLine}"` };
  }
  const stack = [];
  for (const ch of trimmed) {
    if (ch in BRACKET_PAIRS) {
      stack.push(BRACKET_PAIRS[ch]);
    } else if (BRACKET_CLOSERS.has(ch)) {
      if (stack.pop() !== ch) return { valid: false, reason: "unbalanced brackets" };
    }
  }
  if (stack.length > 0) return { valid: false, reason: "unbalanced brackets" };
  return { valid: true };
}

/** @param {{ files: string[], cwd: string }} ctx */
export function checkTableShapes({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    for (const table of parseTables(content)) {
      for (const row of table.rows) {
        if (row.columns !== table.headerColumns) {
          findings.push(
            `${file}:${row.line} table row has ${row.columns} column(s), header (line ${table.startLine}) has ${table.headerColumns}`,
          );
        }
      }
    }
  }
  return findings;
}

/** @param {{ files: string[], cwd: string }} ctx */
export function checkRequirementIds({ files, cwd }) {
  const findings = [];
  const canonicalContent = readFileSync(path.join(cwd, REQUIREMENT_CANONICAL_FILE), "utf8");
  const canonicalLines = canonicalContent.split("\n");

  const headingCounts = new Map();
  canonicalLines.forEach((line) => {
    const match = REQUIREMENT_HEADING_PATTERN.exec(line);
    if (!match) return;
    headingCounts.set(match[1], (headingCounts.get(match[1]) ?? 0) + 1);
  });
  for (const [id, count] of headingCounts) {
    if (count > 1) {
      findings.push(`${REQUIREMENT_CANONICAL_FILE}: requirement ${id} is defined by ${count} headings, expected 1`);
    }
  }

  const canonicalIds = new Set([...canonicalContent.matchAll(REQUIREMENT_ID_PATTERN)].map((m) => m[1]));

  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    content.split("\n").forEach((line, index) => {
      REQUIREMENT_ID_PATTERN.lastIndex = 0;
      let match;
      while ((match = REQUIREMENT_ID_PATTERN.exec(line)) !== null) {
        if (!canonicalIds.has(match[1])) {
          findings.push(`${file}:${index + 1} references undefined requirement ID "${match[1]}"`);
        }
      }
    });
  }
  return findings;
}

/** @param {{ files: string[], cwd: string }} ctx */
export function checkForbiddenEnvVars({ files, cwd }) {
  const findings = [];
  for (const file of files) {
    const content = readFileSync(path.join(cwd, file), "utf8");
    content.split("\n").forEach((line, index) => {
      const lowered = line.toLowerCase();
      const hasNegation = NEGATION_MARKERS.some((marker) => lowered.includes(marker));
      if (hasNegation) return;
      for (const pattern of FORBIDDEN_ENV_PATTERNS) {
        if (pattern.test(line)) {
          findings.push(`${file}:${index + 1} mentions forbidden/legacy env var pattern (${pattern}) outside a negation context`);
        }
      }
    });
  }
  return findings;
}

/** @param {string} allowlistPath */
export function checkFileSizeAllowlistShape(allowlistPath) {
  const findings = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    return [`${allowlistPath}: invalid JSON (${errorMessage(error)})`];
  }
  if (!Array.isArray(raw.entries)) {
    return [`${allowlistPath}: missing "entries" array`];
  }
  for (const entry of raw.entries) {
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      findings.push(`${allowlistPath}: entry missing non-empty "path"`);
      continue;
    }
    if (entry.path.includes("*") || entry.path.includes("?")) {
      findings.push(`${allowlistPath}: entry "${entry.path}" must be an explicit path, not a glob`);
    }
    if (typeof entry.owner !== "string" || entry.owner.length === 0) {
      findings.push(`${allowlistPath}: entry "${entry.path}" missing "owner"`);
    }
    if (typeof entry.reason !== "string" || entry.reason.length === 0) {
      findings.push(`${allowlistPath}: entry "${entry.path}" missing "reason"`);
    }
  }
  return findings;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
