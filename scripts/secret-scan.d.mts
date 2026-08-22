export interface SecretFinding {
  file: string;
  rule: string;
  sample: string;
}

export function listScannableFiles(cwd: string): string[];
export function scanContent(relativePath: string, content: string): SecretFinding[];
export function redact(value: string): string;
export function scanRepository(cwd: string): SecretFinding[];
