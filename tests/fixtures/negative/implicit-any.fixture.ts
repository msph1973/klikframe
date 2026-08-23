// Negative fixture (NFR-CQ-001): an untyped parameter must fail `tsc
// --noEmit --strict` with an implicit-`any` diagnostic (TS7006). This file
// is excluded from the main tsconfig/project and is only compiled directly
// by tests/negative/quality-gates.test.ts.
export function addWithImplicitAny(value) {
  return value + 1;
}
