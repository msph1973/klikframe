import path from "node:path";
import { defineConfig } from "vitest/config";

// Phase 0 ships unit coverage for foundation primitives only. `test:unit`
// runs everything under tests/unit + tests/negative; `test:integration`
// targets tests/integration directly with `--passWithNoTests` (TESTING.md
// §6 ordering) until the data worktree (Step 2) adds a Hono + PostgreSQL
// harness there.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `paths` mapping for Vite's module resolver.
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/server-only-mock.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/negative/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
      // TESTING.md §2.1: >=90% branch coverage for idempotency (and, in
      // later waves, authorization/payment/signature/lifecycle) modules;
      // >=80% for other non-UI code.
      thresholds: {
        branches: 80,
        "lib/idempotency/**": { branches: 90 },
      },
    },
  },
});
