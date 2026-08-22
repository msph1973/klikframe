import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
      // Negative fixtures deliberately violate the rules below; they are
      // linted only via an explicit `--no-ignore` CLI invocation in the
      // negative test suite (tests/negative/quality-gates.test.ts), where
      // `projectService` auto-discovers their dedicated
      // tests/fixtures/negative/tsconfig.json for type-aware parsing.
      "tests/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...nextCoreWebVitals,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // NFR-CQ-001 / AGENTS.md Quality Gates: explicit/implicit/unsafe `any`
      // must fail lint. strictTypeChecked already enables most of these;
      // they are restated explicitly so a future preset change cannot
      // silently downgrade them.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
  {
    files: ["**/*.mjs", "**/*.d.mts", "**/*.d.ts"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },
);
