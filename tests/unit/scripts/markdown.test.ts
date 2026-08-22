import { describe, expect, it } from "vitest";
import {
  parseHeadings,
  parseLocalLinks,
  parseTables,
  findUnterminatedFenceLine,
} from "../../../scripts/docs/markdown.mjs";

describe("parseHeadings", () => {
  it("accepts up to 3 spaces of leading indentation", () => {
    const [heading] = parseHeadings("   ## Indented Heading\n");
    expect(heading?.text).toBe("Indented Heading");
  });

  it("strips an optional closing #-sequence before slugifying", () => {
    const [heading] = parseHeadings("## Heading ##\n");
    expect(heading?.slug).toBe("heading");
  });

  it("strips inline link syntax to its visible text before slugifying", () => {
    const [heading] = parseHeadings("## See [TESTING.md](TESTING.md) for detail\n");
    expect(heading?.slug).toBe("see-testingmd-for-detail");
  });

  it("does not treat a `#` inside a fenced code block as a heading", () => {
    const content = ["```bash", "# not a heading", "```", ""].join("\n");
    expect(parseHeadings(content)).toHaveLength(0);
  });
});

describe("parseLocalLinks", () => {
  it("ignores link-like text inside a fenced code block", () => {
    const content = ["```json", '{ "text": "[fake](not-a-real-link.md)" }', "```", ""].join("\n");
    expect(parseLocalLinks(content)).toHaveLength(0);
  });

  it("still finds a real link outside a fence", () => {
    const content = "See [doc](TESTING.md#6-ci-dan-release-gates) for detail.\n";
    expect(parseLocalLinks(content)).toHaveLength(1);
  });
});

describe("parseTables", () => {
  it("splits a cell containing an escaped pipe", () => {
    const content = ["| A | B |", "|---|---|", "| a\\|b | c |", ""].join("\n");
    const [table] = parseTables(content);
    expect(table?.rows[0]?.columns).toBe(2);
  });

  it("splits a cell containing a pipe inside an inline code span", () => {
    const content = ["| A | B |", "|---|---|", "| `a|b` | c |", ""].join("\n");
    const [table] = parseTables(content);
    expect(table?.rows[0]?.columns).toBe(2);
  });

  it("recognizes a table without outer pipes", () => {
    const content = ["Header1 | Header2", "------- | -------", "Row1 | Row2", ""].join("\n");
    const [table] = parseTables(content);
    expect(table).toBeDefined();
    expect(table?.headerColumns).toBe(2);
    expect(table?.rows[0]?.columns).toBe(2);
  });
});

describe("findUnterminatedFenceLine", () => {
  it("returns null when every fence is closed", () => {
    expect(findUnterminatedFenceLine(["```json", "{}", "```", ""].join("\n"))).toBeNull();
  });

  it("returns the opening line of an unterminated fence", () => {
    expect(findUnterminatedFenceLine(["intro", "```json", "{}", ""].join("\n"))).toBe(2);
  });
});
