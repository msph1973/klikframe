import path from "node:path";
import { defineConfig } from "vitest/config";

// Phase 0 ships unit coverage for foundation primitives only. `include`
// lists all three test roots so `test:integration`'s CLI path filter can
// discover files once they exist; the unit/integration split itself is
// enforced by each npm script's own path argument (test:unit passes
// "tests/unit tests/negative"; test:integration passes "tests/integration
// --passWithNoTests"), not by this shared include list.
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
        // TESTING.md §2.2 provider-boundary rationale: frozen ports and
        // barrels are pure-type re-export surface (no runtime branches);
        // their adapters and fakes carry the tested logic.
        "lib/realtime/realtime-port.ts",
        "lib/providers/email/email-port.ts",
        "lib/providers/storage/storage-types.ts",
        "lib/providers/index.ts",
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
