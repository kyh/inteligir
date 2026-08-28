import { describe, expect, it } from "vitest";

import { scanTaskItems, tasksInTree } from "../knowledge/task-ordinal";
import { parseMdast } from "../markdown/parse";

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
  scanTaskItems(source)[ordinal]?.text;

// The editor's own parse over the same bytes: same plugin list the WYSIWYG
// deserializes with, counted through the one counter.
const editorTaskItems = (source: string): ReturnType<typeof tasksInTree> => {
  const parsed = parseMdast(source);
  if (!parsed.ok) throw new Error(`editor parse refused the fixture: ${parsed.failure.message}`);
  return tasksInTree(parsed.root, source);
};

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
    const tasks = scanTaskItems(DOC);
    const duplicates = tasks.flatMap((task, ordinal) =>
      task.text === "book the flight" ? [{ ordinal, line: task.line }] : [],
    );
    expect(duplicates).toEqual([
      { ordinal: 0, line: 5 },
      { ordinal: 3, line: 11 },
    ]);
  });

  it("matches -, *, + bullets and CRLF/CR line endings", () => {
    expect(textAt("* [ ] star", 0)).toBe("star");
    expect(textAt("+ [ ] plus", 0)).toBe("plus");
    expect(textAt("# H\r\n\r\n- [ ] crlf", 0)).toBe("crlf");
    expect(scanTaskItems("- [ ] cr\r- [ ] second")[1]).toEqual({
      checked: false,
      text: "second",
      line: 2,
    });
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

  it("strips the marker from every list form the editor draws a checkbox for", () => {
    const md = [
      "1. [ ] numbered",
      "12) [x] wide ordered",
      "",
      "> - [ ] quoted",
      "",
      "> > - [x] nested quote",
      "",
      "  * [ ]   spaced  out  ",
    ].join("\n");
    expect(scanTaskItems(md).map((task) => ({ text: task.text, checked: task.checked }))).toEqual([
      { text: "numbered", checked: false },
      { text: "wide ordered", checked: true },
      { text: "quoted", checked: false },
      { text: "nested quote", checked: true },
      { text: "spaced  out", checked: false },
    ]);
  });

  it("keeps inline markdown verbatim in the extracted text (no normalization)", () => {
    expect(textAt("- [ ] **buy** milk", 0)).toBe("**buy** milk");
  });
});

// The count only names the checkbox a reader is looking at while the scan's
// grammar and the editor's agree on the set. Both disable `codeIndented` and
// `htmlFlow`, and these are the docs CommonMark's defaults would split them on.
describe("the editor's parse counts the same items", () => {
  it.each([
    ["a 4-space-indented item", ["Notes", "", "    - [ ] alpha", "", "- [ ] real"].join("\n")],
    ["an item under flow HTML", ["<div>x</div>", "- [ ] under html", "- [x] and after"].join("\n")],
    ["nested, quoted and ordered forms", DOC],
  ])("agrees on %s", (_name, source) => {
    expect(editorTaskItems(source)).toEqual(scanTaskItems(source));
  });
});
