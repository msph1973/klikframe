export interface RuleContext {
  files: string[];
  cwd: string;
}

export interface TraceabilityRow {
  rows: Map<string, string>;
  malformedRows: string[];
}

export function extractTraceabilityRows(lines: string[]): TraceabilityRow;
export function checkTraceabilityCompleteness(ctx: RuleContext): string[];
export function checkRouteVocabulary(ctx: RuleContext): string[];
export function checkStatusVocabulary(ctx: RuleContext): string[];
export function checkRoleVocabulary(ctx: RuleContext): string[];
export function checkAblyScopeConsistency(ctx: RuleContext): string[];
