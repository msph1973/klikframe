import path from "node:path";
import { defineConfig } from "vitest/config";

// Phase 0 ships unit coverage for foundation primitives and the pure data
// layer. `include` lists all three test roots so `test:integration`'s CLI
// path filter can discover files once they exist; the unit/integration
// split itself is enforced by each npm script's own path argument
// (test:unit passes "tests/unit tests/negative"; test:integration passes
// "tests/integration --passWithNoTests"), not by this shared include list.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `paths` mapping for Vite's module resolver.
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/server-only-mock.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/negative/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts"],
      exclude: [
        "lib/**/*.d.ts",
        // Both waves' exclusions, merged (PR #9 + PR #10):
        // - lib/providers/index.ts is a pure barrel (no executable statements).
        // - Port/type modules with runtime branches — e.g.
        //   lib/realtime/realtime-port.ts (assertRealtimeTokenTtl),
        //   lib/providers/storage/storage-types.ts (storageProviderError) —
        //   stay IN so v8 counts their untested branches against thresholds
        //   (TESTING.md §2.1).
        // - The PostgreSQL-bound execution surface stays out of the unit
        //   branch budget: `lib/db/client.ts` opens real connections and
        //   `transaction-runner.ts` drives real serializable transactions, so
        //   their behavioral coverage is inherently integration-shaped
        //   (tests/integration, TESTING.md §2.2, skipped without a real
        //   TEST_DATABASE_URL). Everything else in lib/db is pure and MUST
        //   stay enforced: `schema/**` (column/enum contracts),
        //   `advisory-lock.ts` key math, and the runner's retry-policy
        //   constants are all covered by tests/unit/db. The previous
        //   blanket `lib/db/**` glob dropped that tested pure code from the
        //   gate (PRRT_kwDOT_C_FM6bh72C).
        "lib/providers/index.ts",
        "lib/db/client.ts",
        "lib/db/transaction-runner.ts",
        "lib/onboarding/**",
      ],
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
