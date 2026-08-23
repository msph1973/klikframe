export interface RuleContext {
  files: string[];
  cwd: string;
}

export function checkLocalLinks(ctx: RuleContext): string[];
export function checkJsonFences(ctx: RuleContext): string[];
export function checkMermaidFences(ctx: RuleContext): string[];
export function validateMermaidBlock(code: string): { valid: boolean; reason?: string };
export function checkTableShapes(ctx: RuleContext): string[];
export function checkUnterminatedFences(ctx: RuleContext): string[];
export function checkRequirementIds(ctx: RuleContext): string[];
export function checkForbiddenEnvVars(ctx: RuleContext): string[];
export function checkFileSizeAllowlistShape(allowlistPath: string): string[];
