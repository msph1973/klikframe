/**
 * Frozen transaction-runner contract (DATABASE_SCHEMA.md §7). Vendor-neutral
 * on purpose: the data worktree (Phase 0 Step 2) implements this with a
 * Drizzle/Neon serializable transaction, but no caller may depend on that
 * transaction context's shape directly.
 */
export interface TransactionRunner<TxContext> {
  run<T>(work: (tx: TxContext) => Promise<T>): Promise<T>;
}
