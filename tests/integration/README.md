# Integration Tests — Data Layer (Phase 0)

Owned by the data worktree per `.junie/plans/implement-phase-0-with-parallel-agents.md`
Step 2 and `TESTING.md` §2.2.

## Harness contract

These tests activate automatically once CI provides a disposable PostgreSQL
endpoint in `TEST_DATABASE_URL`. The intended harness:

1. **Database**: one disposable Neon branch (or equivalent ephemeral
   PostgreSQL) per CI run, exposed through `TEST_DATABASE_URL`. It must be a
   **direct (non-pooled) migration URL** so `drizzle-kit migrate` and
   transactional DDL behave like production (`DEPLOYMENT.md` §3/§4).
2. **Migrations**: the harness applies the checked-in `drizzle/` migrations
   before the suite runs (`npx drizzle-kit migrate` with
   `DATABASE_MIGRATION_URL=$TEST_DATABASE_URL`). No test creates schema
   objects directly; `drizzle-kit push` is forbidden.
3. **Seeding**: no fixture SQL. Tests seed through the application's own
   repository functions inside real transactions so constraints/triggers are
   exercised exactly as production would.
4. **Isolation**: each test uses a unique run namespace
   (`auth_user_id`/slug suffixes from the test ID) and never touches
   `schema neon_auth` (DATABASE_SCHEMA.md §1).
5. **Cleanup**: the whole branch/database is discarded after the run; tests
   never delete rows belonging to other runs.

Until CI wires `TEST_DATABASE_URL`, every scenario below is registered as a
skipped Vitest test with its full assertion body, so `npm run
test:integration` stays green while remaining an executable specification.
Enable them by replacing the module-level guard in
`tests/integration/helpers/db.ts` (remove `describe.skip` wiring) once the
harness exists — do NOT delete or rewrite the scenarios.

## Scenario list (encoded as skipped tests below)

1. **Concurrent double-onboarding, same identity** — two transactions race
   through `runOnboardingTransaction` for one `auth_user_id`; assert exactly
   1 workspace + 1 active owner membership exist afterwards (unique partial
   indexes decide the winner; loser retries and observes the same rows).
2. **Idempotency replay, same key + same body hash** — second request reads
   the stored response and replays it instead of re-running writes.
3. **Idempotency replay, same key + different body** → the store reports a
   conflict which the route layer maps to `409 IDEMPOTENCY_CONFLICT`.
4. **Different identity, same slug** — slug unique constraint rejects the
   second workspace creation; assert zero orphan profile/membership rows for
   the failed attempt.
5. **Fault injection after each write step** — throw between profile,
   workspace, membership, audit, and idempotency inserts; every variant must
   roll back completely (row counts unchanged after rollback).
6. **Cross-workspace composite FK rejection** — inserting a child row whose
   `workspace_id` points at another tenant must fail at the database level
   (FK violation), not merely in service code.

Each skipped test documents the exact Postgres error code it expects where
relevant: `40001` serialization failure (scenario 1 retry), `23505` unique
violation (scenarios 1/3/4), `23503` FK violation (scenario 6).
