export type FileSizeSeverity = "ok" | "review" | "fail";

export interface FileSizeResult {
  filePath: string;
  lineCount: number;
  severity: FileSizeSeverity;
}

export const REVIEW_TARGET_LINES: number;
export const HARD_FAIL_LINES: number;

export function countPhysicalLines(content: string): number;
export function isSourceOrTestFile(relativePath: string): boolean;
export function evaluateFile(
  filePath: string,
  lineCount: number,
  allowlist: Set<string>,
): FileSizeResult;
export function loadAllowlist(allowlistPath: string): Set<string>;
export function checkRepository(options: { cwd: string; allowlistPath: string }): FileSizeResult[];
