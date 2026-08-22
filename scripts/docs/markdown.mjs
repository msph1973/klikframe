// Minimal Markdown structural parsing shared by docs-check rules.
// Deliberately dependency-free: Phase 0 foundation avoids pulling a full
// remark/mermaid toolchain for a handful of structural checks.

const HEADING_LINE = /^(#{1,6})\s+(.*)$/;
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const FENCE_OPEN = /^```([A-Za-z0-9_-]*)\s*$/;
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

/**
 * @param {string} content
 * @returns {{ level: number, text: string, slug: string, line: number }[]}
 */
export function parseHeadings(content) {
  const lines = content.split("\n");
  const seen = new Map();
  const headings = [];
  lines.forEach((line, index) => {
    const match = HEADING_LINE.exec(line);
    if (!match) return;
    const level = match[1].length;
    const text = match[2].trim();
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
  const links = [];
  content.split("\n").forEach((line, index) => {
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
 * @returns {{ startLine: number, headerColumns: number, rows: { line: number, columns: number }[] }[]}
 */
export function parseTables(content) {
  const lines = content.split("\n");
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const separator = lines[i + 1];
    if (
      header?.trim().startsWith("|") &&
      separator !== undefined &&
      TABLE_SEPARATOR_ROW.test(separator)
    ) {
      const headerColumns = splitRow(header).length;
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
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

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|");
}
