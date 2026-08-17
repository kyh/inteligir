import { describe, expect, it } from "vitest";

import { scanTaskItems } from "../knowledge/task-ordinal";

const DOC = [
  "# Project",
  "",
  "## This week",
  "",
  "- [ ] book the flight", // ordinal 0
  "- [x] already done", //    ordinal 1 (checked)
  "- [ ] email the team", //  ordinal 2
  "",
  "## Backlog",
  "",
  "- [ ] book the flight", // ordinal 3 — same label, different position
].join("\n");

const textAt = (source: string, ordinal: number): string | undefined =>
  scanTaskItems(source).find((task) => task.ordinal === ordinal)?.text;

describe("the count", () => {
  it("counts every task item, checked or not, in document order", () => {
    expect(scanTaskItems(DOC).map((task) => ({ text: task.text, checked: task.checked }))).toEqual([
      { text: "book the flight", checked: false },
      { text: "already done", checked: true },
      { text: "email the team", checked: false },
      { text: "book the flight", checked: false },
    ]);
  });

  it("distinguishes duplicate labels purely by position", () => {
    const duplicates = scanTaskItems(DOC).filter((task) => task.text === "book the flight");
    expect(duplicates.map((task) => task.ordinal)).toEqual([0, 3]);
    expect(duplicates.map((task) => task.line)).toEqual([5, 11]);
  });

  it("matches -, *, + bullets and CRLF/CR line endings", () => {
    expect(textAt("* [ ] star", 0)).toBe("star");
    expect(textAt("+ [ ] plus", 0)).toBe("plus");
    expect(textAt("# H\r\n\r\n- [ ] crlf", 0)).toBe("crlf");
    expect(scanTaskItems("- [ ] cr\r- [ ] second")[1]?.raw).toBe("- [ ] second");
  });

  it("does not count checkbox-like lines inside fenced code", () => {
    const md = ["```", "- [ ] not a task", "```", "", "- [ ] real task"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real task"]);
  });

  it("only closes a fence on a matching marker (mixed ``` / ~~~ don't desync)", () => {
    const md = [
      "~~~",
      "- [ ] fake one",
      "```", //            a different fence marker inside — must NOT close the ~~~ block
      "- [ ] fake two",
      "~~~", //            closes the block
      "",
      "- [ ] real",
    ].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real"]);
  });

  it("counts a 4-space-indented checkbox (no indented code in the canonical flavor)", () => {
    // The editor's grammar has no indented-code construct, so the editor renders
    // this line as a live task and the ordinal counts it. A parser that treated
    // the indent as a code block would skip the line and desync every later
    // ordinal from the editor's.
    const md = ["Notes", "", "    - [ ] alpha", "", "- [ ] real"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["alpha", "real"]);
  });

  it("counts nested task items in document order", () => {
    const md = ["- [ ] parent", "  - [ ] child", "- [ ] sibling"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["parent", "child", "sibling"]);
  });

  it("doesn't count a plain bullet that follows a task in the same list", () => {
    // remark gives the plain bullet checked:null and the editor draws no widget
    // for it — both exclude it, so the ordinal stays aligned.
    const md = ["- [ ] real one", "- plain", "- [x] real two"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real one", "real two"]);
  });

  it("doesn't count an empty checkbox (nothing follows the marker)", () => {
    const md = ["- [ ] ", "- [ ] real task"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real task"]);
  });

  it("ignores checkbox-shaped lines inside YAML frontmatter", () => {
    // Without frontmatter awareness the leading `---` parses as a thematic break
    // and the YAML's `- [ ]` line would consume ordinal 0 — while scanDoc and
    // the editor (both frontmatter-aware) skip it.
    const md = ["---", "checklist:", "  - [ ] yaml lookalike", "---", "", "- [ ] real task"].join(
      "\n",
    );
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real task"]);
  });

  it("keeps `raw` byte-exact, terminator excluded", () => {
    const crlf = "- [ ]   spaced  out  \r\n";
    expect(scanTaskItems(crlf)[0]?.raw).toBe("- [ ]   spaced  out  ");
  });

  it("counts ordered and blockquoted items with the marker stripped from `text`", () => {
    const md = ["1. [ ] numbered", "2) [x] parenthesized", "", "> - [ ] quoted"].join("\n");
    expect(scanTaskItems(md).map((task) => ({ text: task.text, checked: task.checked }))).toEqual([
      { text: "numbered", checked: false },
      { text: "parenthesized", checked: true },
      { text: "quoted", checked: false },
    ]);
  });

  it("keeps inline markdown verbatim in the extracted text (no normalization)", () => {
    expect(textAt("- [ ] **buy** milk", 0)).toBe("**buy** milk");
  });
});
