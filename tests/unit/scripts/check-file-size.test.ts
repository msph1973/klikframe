import { describe, expect, it } from "vitest";
import { isSourceOrTestFile } from "../../../scripts/check-file-size.mjs";

describe("isSourceOrTestFile", () => {
  it.each([
    "lib/http/app.ts",
    "app/page.tsx",
    "lib/db/schema.mts",
    "lib/db/config.cts",
    "scripts/build.mjs",
    "scripts/legacy.cjs",
    "components/Widget.jsx",
  ])("scans %s", (relativePath) => {
    expect(isSourceOrTestFile(relativePath)).toBe(true);
  });

  it.each(["config/file-size-allowlist.json", "README.md", "package-lock.json"])(
    "does not scan non-source %s",
    (relativePath) => {
      expect(isSourceOrTestFile(relativePath)).toBe(false);
    },
  );

  it("excludes build/dependency directories regardless of extension", () => {
    expect(isSourceOrTestFile("node_modules/pkg/index.js")).toBe(false);
    expect(isSourceOrTestFile(".next/server/app/page.js")).toBe(false);
  });
});
