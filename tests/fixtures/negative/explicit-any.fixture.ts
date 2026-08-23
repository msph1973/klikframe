// Negative fixture (NFR-CQ-001): explicit `any` and the unsafe operations
// it enables must fail ESLint (`@typescript-eslint/no-explicit-any`,
// `no-unsafe-assignment`, `no-unsafe-member-access`). This file is globally
// ignored by `eslint.config.mjs` and only linted directly, with
// `--no-ignore`, by tests/negative/quality-gates.test.ts.
const value: any = { greeting: "hello" };
export const greeting: string = value.greeting;
