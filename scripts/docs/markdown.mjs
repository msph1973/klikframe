// Minimal Markdown structural parsing shared by docs-check rules.
// Deliberately dependency-free: Phase 0 foundation avoids pulling a full
// remark/mermaid toolchain for a handful of structural checks.

// CommonMark allows up to 3 leading spaces before a block marker; 4+ makes
// it an indented code block instead.
const HEADING_LINE = /^ {0,3}(#{1,6})\s+(.*)$/;
const CLOSING_HASH_SUFFIX = /\s+#+\s*$/;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const FENCE_OPEN = /^ {0,3}```([A-Za-z0-9_-]*)\s*$/;
const TABLE_SEPARATOR_ROW = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

/**
 * @param {string} heading raw heading text (without leading `#` markers)
 * @returns {string} GitHub-compatible anchor slug
 */
export function githubSlug(heading) {
  const lowered = heading.toLowerCase();
  let kept = "";
  for (const ch of lowered) {
    if (/[a-z0-9 _-]/.test(ch)) kept += ch;
  }
  return kept.replace(/ /g, "-");
}

/** Strips an ATX heading's optional closing `#`s and inline link syntax before slugifying. */
function headingVisibleText(rawText) {
  const withoutClosingHashes = rawText.replace(CLOSING_HASH_SUFFIX, "");
  return withoutClosingHashes.replace(INLINE_LINK, "$1");
}

/** 0-based line indices that fall strictly inside a fenced code block. */
function computeFencedLineNumbers(lines) {
  const fenced = new Set();
  let open = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!open) {
      if (FENCE_OPEN.test(lines[i])) open = true;
      continue;
    }
    fenced.add(i);
    if (lines[i].trim() === "```") open = false;
  }
  return fenced;
}

/**
 * @param {string} content
 * @returns {{ level: number, text: string, slug: string, line: number }[]}
 */
export function parseHeadings(content) {
  const lines = content.split("\n");
  const fenced = computeFencedLineNumbers(lines);
  const seen = new Map();
  const headings = [];
  lines.forEach((line, index) => {
    if (fenced.has(index)) return;
    const match = HEADING_LINE.exec(line);
    if (!match) return;
    const level = match[1].length;
    const text = headingVisibleText(match[2].trim());
    const baseSlug = githubSlug(text);
    const count = seen.get(baseSlug) ?? 0;
    seen.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    headings.push({ level, text, slug, line: index + 1 });
  });
  return headings;
}

/**
 * @param {string} content
 * @returns {{ text: string, target: string, line: number }[]} local links only
 */
export function parseLocalLinks(content) {
  const lines = content.split("\n");
  const fenced = computeFencedLineNumbers(lines);
  const links = [];
  lines.forEach((line, index) => {
    if (fenced.has(index)) return;
    LINK_PATTERN.lastIndex = 0;
    let match;
    while ((match = LINK_PATTERN.exec(line)) !== null) {
      const target = match[2];
      if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith("mailto:")) continue;
      links.push({ text: match[1], target, line: index + 1 });
    }
  });
  return links;
}

/**
 * @param {string} content
 * @param {string} [lang] restrict to a fence info-string, e.g. "json"
 * @returns {{ lang: string, code: string, line: number }[]}
 */
export function parseFencedBlocks(content, lang) {
  const lines = content.split("\n");
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (open === null) {
      const match = FENCE_OPEN.exec(lines[i]);
      if (match) open = { lang: match[1], startLine: i + 1, bodyStart: i + 1 };
      continue;
    }
    if (lines[i].trim() === "```") {
      const code = lines.slice(open.bodyStart, i).join("\n");
      if (!lang || open.lang === lang) {
        blocks.push({ lang: open.lang, code, line: open.startLine });
      }
      open = null;
    }
  }
  return blocks;
}

/**
 * @param {string} content
 * @returns {number | null} 1-based line of a fence opened but never closed, or null
 */
export function findUnterminatedFenceLine(content) {
  const lines = content.split("\n");
  let openLine = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (openLine === null) {
      if (FENCE_OPEN.test(lines[i])) openLine = i + 1;
      continue;
    }
    if (lines[i].trim() === "```") openLine = null;
  }
  return openLine;
}

/**
 * @param {string} content
 * @returns {{ startLine: number, headerColumns: number, rows: { line: number, columns: number }[] }[]}
 */
export function parseTables(content) {
  const lines = content.split("\n");
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const separator = lines[i + 1];
    if (header !== undefined && separator !== undefined && TABLE_SEPARATOR_ROW.test(separator)) {
      const headerColumns = splitRow(header).length;
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== "" && lines[j].includes("|")) {
        rows.push({ line: j + 1, columns: splitRow(lines[j]).length });
        j += 1;
      }
      tables.push({ startLine: i + 1, headerColumns, rows });
      i = j;
      continue;
    }
    i += 1;
  }
  return tables;
}

/** Splits a table row on unescaped pipes outside inline code spans. */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "`") {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|" && !inCode) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
