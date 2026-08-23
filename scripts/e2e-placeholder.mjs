#!/usr/bin/env node
// Phase 0 has no Vercel preview deployment or Playwright harness yet
// (TESTING.md §2.4). This keeps `npm run test:e2e` present and correctly
// ordered in CI (TESTING.md §6) without asserting coverage that does not
// exist. The verifier worktree (Phase 0 Step 5) replaces this script with
// a real Playwright run against a preview deployment.
console.log(
  "test:e2e: no preview/Playwright harness yet (owned by the Phase 0 verifier wave, Step 5). Skipping.",
);
