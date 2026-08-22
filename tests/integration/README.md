# Integration Tests

Owned by the data worktree (Phase 0 Step 2) and the integration worktree
(Step 4), per `.junie/plans/implement-phase-0-with-parallel-agents.md`.

This directory is intentionally empty in the foundation wave. `npm run
test:integration` runs `vitest run --project integration --passWithNoTests`
so the CI step stays green until a Hono + PostgreSQL harness (disposable
Neon branch, real migrations, `IdentitySessionPort` test adapter per
`TESTING.md` §2.2) lands here.
