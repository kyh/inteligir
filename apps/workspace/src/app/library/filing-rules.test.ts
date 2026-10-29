import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FILING_RULES_TEXT } from "./filing-rules";

// the starter library ships these same rules as its AGENTS.md, so "Edit filing rules…" on a
// library made before the starter and Tidy on one made from it start from one text
const STARTER_RULES = path.resolve(import.meta.dirname, "../../../../cli/seed/AGENTS.md");

describe("the filing rules", () => {
  it("are the starter library's AGENTS.md, byte for byte", () => {
    expect(readFileSync(STARTER_RULES, "utf-8")).toBe(FILING_RULES_TEXT);
  });
});
