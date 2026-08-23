// Minimal Markdown structural parsing shared by docs-check rules.
// Deliberately dependency-free: Phase 0 foundation avoids pulling a full
// remark/mermaid toolchain for a handful of structural checks.

// CommonMark allows up to 3 leading spaces before a block marker; 4+ makes
// it an indented code block instead.
const HEADING_LINE = /^ {0,3}(#{1,6})\s+(.*)$/;
const CLOSING_HASH_SUFFIX = /\s+#+\s*$/;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/g;
// A fence marker is 3+ backticks or 3+ tildes (CommonMark); the closer
// must use the same character and be at least as long as the opener. The
// info-string (language) may be separated from the marker by whitespace
// ("~~~ json" is as valid as "~~~json").
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/;
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

/**
 * Single-pass fence tracker shared by every fence-aware consumer below, so
 * open/close matching (variable marker length, backtick-vs-tilde, ≤3-space
 * indentation on both ends) is defined exactly once.
 * @param {string[]} lines
 * @returns {{ fencedLines: Set<number>, blocks: { lang: string, code: string, line: number }[], unterminatedAt: number | null }}
 */
function scanFences(lines) {
  const fencedLines = new Set();
  const blocks = [];
  let open = null; // { char, len, lang, startLine, bodyStart }
  for (let i = 0; i < lines.length; i += 1) {
    if (open === null) {
      const match = FENCE_OPEN.exec(lines[i]);
      if (match) {
        const marker = match[1];
        open = { char: marker[0], len: marker.length, lang: match[2], startLine: i, bodyStart: i + 1 };
      }
      continue;
    }
    fencedLines.add(i);
    const closes = new RegExp(`^ {0,3}${open.char}{${String(open.len)},}\\s*$`).test(lines[i]);
    if (closes) {
      blocks.push({
        lang: open.lang,
        code: lines.slice(open.bodyStart, i).join("\n"),
        line: open.startLine + 1,
      });
      open = null;
    }
  }
  return { fencedLines, blocks, unterminatedAt: open ? open.startLine + 1 : null };
}

/**
 * @param {string} content
 * @returns {{ level: number, text: string, slug: string, line: number }[]}
 */
export function parseHeadings(content) {
  const lines = content.split("\n");
  const { fencedLines } = scanFences(lines);
  const seen = new Map();
  const headings = [];
  lines.forEach((line, index) => {
    if (fencedLines.has(index)) return;
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
  const { fencedLines } = scanFences(lines);
  const links = [];
  lines.forEach((line, index) => {
    if (fencedLines.has(index)) return;
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
  const { blocks } = scanFences(content.split("\n"));
  return lang ? blocks.filter((block) => block.lang === lang) : blocks;
}

/**
 * @param {string} content
 * @returns {number | null} 1-based line of a fence opened but never closed, or null
 */
export function findUnterminatedFenceLine(content) {
  return scanFences(content.split("\n")).unterminatedAt;
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
      // A line continues the table only while it still looks like a row:
      // it must contain at least one real (non-code-span) pipe delimiter,
      // OR be an outer-pipe-only row like `| only |` — malformed, but it
      // must surface as a column-mismatch finding, not be silently
      // dropped. A prose line whose only pipe is inside a code span has
      // neither, so it ends the table instead of becoming a phantom row.
      while (j < lines.length && isTableRowCandidate(lines[j])) {
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

/**
 * Splits a table row on unescaped pipes outside inline code spans. A code
 * span may open/close with a run of 2+ backticks (not just one), and only
 * a run of the *same* length closes it (CommonMark backtick-code-span rule).
 */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let codeSpanDelimLen = 0;
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "`") {
      let runLen = 0;
      while (trimmed[i + runLen] === "`") runLen += 1;
      if (codeSpanDelimLen === 0) {
        codeSpanDelimLen = runLen;
      } else if (runLen === codeSpanDelimLen) {
        codeSpanDelimLen = 0;
      }
      current += "`".repeat(runLen);
      i += runLen;
      continue;
    }
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 2;
      continue;
    }
    if (ch === "|" && codeSpanDelimLen === 0) {
      cells.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  cells.push(current);
  return cells;
}

/**
 * True when a line should keep being consumed as part of a table body:
 * either it splits into multiple cells (a real, non-code-span pipe acted
 * as a delimiter) or it is an outer-pipe-only line (`| x |` shape — one
 * cell after trimming the outer pipes). The latter is kept so a
 * malformed row still surfaces via checkTableShapes instead of being
 * silently skipped; prose mentioning `|` only inside a code span fails
 * both tests and correctly terminates the table.
 */
function isTableRowCandidate(line) {
  if (line.trim() === "") return false;
  const trimmed = line.trim();
  const hasOuterPipes =
    trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length >= 2;
  return splitRow(line).length > 1 || hasOuterPipes;
}
