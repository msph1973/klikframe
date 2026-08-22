export interface HeadingInfo {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface LocalLink {
  text: string;
  target: string;
  line: number;
}

export interface FencedBlock {
  lang: string;
  code: string;
  line: number;
}

export interface TableRow {
  line: number;
  columns: number;
}

export interface TableInfo {
  startLine: number;
  headerColumns: number;
  rows: TableRow[];
}

export function githubSlug(heading: string): string;
export function parseHeadings(content: string): HeadingInfo[];
export function parseLocalLinks(content: string): LocalLink[];
export function parseFencedBlocks(content: string, lang?: string): FencedBlock[];
export function findUnterminatedFenceLine(content: string): number | null;
export function parseTables(content: string): TableInfo[];
