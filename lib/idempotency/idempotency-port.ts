import { createHash } from "node:crypto";

/**
 * Frozen idempotency contract (API_SPEC.md §1.4). A key is scoped by
 * principal + route + key for at least 24h; a replay with a different
 * request body hash is a conflict, a matching hash replays the original
 * response. The data worktree (Phase 0 Step 2) backs `IdempotencyStore`
 * with a real `idempotency_requests` table.
 */
export const IDEMPOTENCY_MIN_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyKeyScope {
  readonly principalId: string;
  readonly route: string;
  readonly key: string;
}

export interface IdempotencyRecord {
  readonly scope: IdempotencyKeyScope;
  readonly requestBodyHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly expiresAt: Date;
}

export type IdempotencyOutcome =
  | { readonly kind: "new" }
  | { readonly kind: "replay"; readonly record: IdempotencyRecord }
  | { readonly kind: "conflict" };

export interface IdempotencyStore {
  begin(scope: IdempotencyKeyScope, requestBodyHash: string): Promise<IdempotencyOutcome>;
  complete(
    scope: IdempotencyKeyScope,
    result: { readonly status: number; readonly body: unknown },
  ): Promise<void>;
}

/**
 * Deterministic SHA-256 hash of a JSON-serializable request body, with
 * object keys sorted so equivalent payloads with different key order hash
 * identically. Array order is preserved (arrays are ordered data).
 */
export function computeCanonicalBodyHash(body: unknown): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function canonicalize(value: unknown): string {
  // Real HTTP JSON bodies never contain `undefined` (JSON has no such
  // literal); this only guards a JS object literal built programmatically
  // (e.g. `{a: undefined}`). Mapping it to the same token as `null` is an
  // accepted trade-off so hashing never throws or emits the bare `undefined`
  // value into a template string (gitar-bot #2).
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalize(item)).join(",")}]`;
  }
  // Code-point order, not `localeCompare`: the hash is persisted and
  // compared across instances/environments, so key ordering must be
  // stable regardless of ICU/locale configuration (gitar-bot #1).
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const body = entries
    .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`)
    .join(",");
  return `{${body}}`;
}
