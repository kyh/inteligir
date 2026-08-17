import { describe, expect, it } from "vitest";

import {
  openTaskAtOrdinal,
  resolveTaskAnchor,
  scanTaskItems,
  taskAtOrdinal,
  toggleTaskAtOrdinal,
} from "../knowledge/task-ordinal";

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
    expect(resolveTaskAnchor(DOC, 0)).toMatchObject({ ok: true, anchor: { heading: "This week" } });
    expect(resolveTaskAnchor(DOC, 3)).toMatchObject({ ok: true, anchor: { heading: "Backlog" } });
  });

  it("matches -, *, + bullets and CRLF/CR line endings", () => {
    expect(taskAtOrdinal("* [ ] star", 0)?.text).toBe("star");
    expect(taskAtOrdinal("+ [ ] plus", 0)?.text).toBe("plus");
    expect(taskAtOrdinal("# H\r\n\r\n- [ ] crlf", 0)?.text).toBe("crlf");
    expect(taskAtOrdinal("- [ ] cr\r- [ ] second", 1)?.raw).toBe("- [ ] second");
  });

  it("does not count checkbox-like lines inside fenced code", () => {
    const md = ["```", "- [ ] not a task", "```", "", "- [ ] real task"].join("\n");
    expect(taskAtOrdinal(md, 0)?.text).toBe("real task");
    expect(taskAtOrdinal(md, 1)).toBeNull();
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
    expect(taskAtOrdinal(md, 0)?.text).toBe("real");
    expect(taskAtOrdinal(md, 1)).toBeNull();
  });

  it("counts a 4-space-indented checkbox (no indented code in the canonical flavor)", () => {
    // The editor's grammar has no indented-code construct, so the editor renders
    // this line as a live task and the ordinal counts it. A parser that treated
    // the indent as a code block would skip the line and desync every later
    // ordinal from the editor's.
    const md = ["Notes", "", "    - [ ] alpha", "", "- [ ] real"].join("\n");
    expect(taskAtOrdinal(md, 0)?.text).toBe("alpha");
    expect(taskAtOrdinal(md, 1)?.text).toBe("real");
    expect(taskAtOrdinal(md, 2)).toBeNull();
  });

  it("counts nested task items in document order", () => {
    const md = ["- [ ] parent", "  - [ ] child", "- [ ] sibling"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["parent", "child", "sibling"]);
  });

  it("doesn't count a plain bullet that follows a task in the same list", () => {
    // remark gives the plain bullet checked:null (and Plate a phantom todo with
    // no `checked`) — both exclude it, so the ordinal stays aligned.
    const md = ["- [ ] real one", "- plain", "- [x] real two"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real one", "real two"]);
  });

  it("doesn't count an empty checkbox (Plate renders `- [ ] ` as a plain bullet)", () => {
    // A bare checkbox with no text deserializes to a non-todo in Plate, so the
    // editor's todoIndex skips it — the count here must too, or ordinals desync.
    const md = ["- [ ] ", "- [ ] real task"].join("\n");
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real task"]);
  });

  it("ignores checkbox-shaped lines inside YAML frontmatter", () => {
    // Without frontmatter awareness the leading `---` parses as a thematic break
    // and the YAML's `- [ ]` line would consume ordinal 0 — while scanDoc and
    // the Plate pipeline (both frontmatter-aware) skip it.
    const md = ["---", "checklist:", "  - [ ] yaml lookalike", "---", "", "- [ ] real task"].join(
      "\n",
    );
    expect(scanTaskItems(md).map((task) => task.text)).toEqual(["real task"]);
  });

  it("keeps `raw` byte-exact, terminator excluded, so it can guard a write", () => {
    const crlf = "- [ ]   spaced  out  \r\n";
    expect(taskAtOrdinal(crlf, 0)?.raw).toBe("- [ ]   spaced  out  ");
  });

  it("counts ordered and blockquoted items with the marker stripped from `text`", () => {
    const md = ["1. [ ] numbered", "2) [x] parenthesized", "", "> - [ ] quoted"].join("\n");
    expect(scanTaskItems(md).map((task) => ({ text: task.text, checked: task.checked }))).toEqual([
      { text: "numbered", checked: false },
      { text: "parenthesized", checked: true },
      { text: "quoted", checked: false },
    ]);
  });
});

// The two state rules, side by side. Same ordinal, same item, different verdict
// — that is the module's one deliberate asymmetry and it stays a decision.
describe("the two state rules over one count", () => {
  it("refuses a checked item to a delegator and accepts it for a toggle", () => {
    expect(openTaskAtOrdinal(DOC, 1)).toEqual({ ok: false, reason: "already-done" });
    expect(resolveTaskAnchor(DOC, 1)).toEqual({ ok: false, reason: "already-done" });
    // The same ordinal, through the write side: untickable, because unticking is
    // half of what toggling means.
    expect(toggleTaskAtOrdinal(DOC, 1, "- [x] already done")).toMatchObject({
      ok: true,
      checked: false,
    });
  });

  it("tells an absent task apart from a finished one", () => {
    expect(openTaskAtOrdinal(DOC, 9)).toEqual({ ok: false, reason: "no-such-task" });
    expect(resolveTaskAnchor(DOC, 9)).toEqual({ ok: false, reason: "no-such-task" });
  });

  it("hands an open item to both, off the same lookup", () => {
    const open = openTaskAtOrdinal(DOC, 2);
    expect(open).toMatchObject({ ok: true, task: { text: "email the team", checked: false } });
    expect(taskAtOrdinal(DOC, 2)?.raw).toBe("- [ ] email the team");
  });
});

describe("resolveTaskAnchor", () => {
  it("resolves the line, its text and the heading over it", () => {
    expect(resolveTaskAnchor(DOC, 0)).toEqual({
      ok: true,
      anchor: {
        lineText: "- [ ] book the flight",
        text: "book the flight",
        heading: "This week",
      },
    });
  });

  it("ignores heading-like lines inside fenced code for context", () => {
    const md = ["## Real heading", "", "```", "## fake heading", "```", "", "- [ ] task"].join(
      "\n",
    );
    expect(resolveTaskAnchor(md, 0)).toMatchObject({
      ok: true,
      anchor: { heading: "Real heading" },
    });
  });

  it("handles a task with no heading above it", () => {
    expect(resolveTaskAnchor("- [ ] lonely", 0)).toMatchObject({
      ok: true,
      anchor: { heading: null },
    });
  });

  it("keeps inline markdown verbatim in the resolved text (no normalization)", () => {
    expect(resolveTaskAnchor("- [ ] **buy** milk", 0)).toMatchObject({
      ok: true,
      anchor: { text: "**buy** milk" },
    });
  });
});

describe("toggleTaskAtOrdinal", () => {
  const TOGGLE_DOC = [
    "---",
    "title: has frontmatter",
    "---",
    "",
    "- [ ] review PR", //   ordinal 0
    "",
    "## Later",
    "",
    "- [ ] review PR", //   ordinal 1 — byte-identical duplicate
    "- [x] shipped", //     ordinal 2
  ].join("\n");

  it("locates by ordinal, so duplicate identical lines can't steal the write", () => {
    const result = toggleTaskAtOrdinal(TOGGLE_DOC, 1, "- [ ] review PR");
    if (!result.ok) throw new Error("toggle failed");
    const lines = result.content.split("\n");
    expect(lines[4]).toBe("- [ ] review PR"); // ordinal 0 untouched
    expect(lines[8]).toBe("- [x] review PR"); // ordinal 1 flipped
  });

  it("survives lines shifting above the task (content-addressed, not line-addressed)", () => {
    const shifted = `inserted paragraph\n\n${TOGGLE_DOC.slice(TOGGLE_DOC.indexOf("- [ ] review PR"))}`;
    const result = toggleTaskAtOrdinal(shifted, 1, "- [ ] review PR");
    if (!result.ok) throw new Error("toggle failed");
    expect(result.content).toContain("## Later\n\n- [x] review PR");
  });

  it("refuses when the ordinal-th task's text drifted (line-changed)", () => {
    expect(toggleTaskAtOrdinal(TOGGLE_DOC, 0, "- [ ] review PR again")).toEqual({
      ok: false,
      reason: "line-changed",
    });
  });

  it("refuses a vanished ordinal (line-missing)", () => {
    expect(toggleTaskAtOrdinal(TOGGLE_DOC, 5, "- [ ] review PR")).toEqual({
      ok: false,
      reason: "line-missing",
    });
  });

  it("ignores checkbox-shaped lines in frontmatter and fenced code when counting", () => {
    const tricky = [
      "---",
      "notes:",
      "  - [ ] yaml lookalike",
      "---",
      "",
      "```",
      "- [ ] fenced lookalike",
      "```",
      "",
      "- [ ] the only real task",
    ].join("\n");
    const result = toggleTaskAtOrdinal(tricky, 0, "- [ ] the only real task");
    if (!result.ok) throw new Error("toggle failed");
    expect(result.content).toContain("- [x] the only real task");
    expect(result.content).toContain("- [ ] yaml lookalike"); // untouched
    expect(result.content).toContain("- [ ] fenced lookalike"); // untouched
  });

  it("toggles by ordinal on a CRLF file (extraction raw ↔ guard agreement)", () => {
    const crlf = "# H\r\n\r\n- [ ] first\r\n- [ ] second\r\n";
    const result = toggleTaskAtOrdinal(crlf, 1, "- [ ] second");
    expect(result).toEqual({
      ok: true,
      checked: true,
      content: "# H\r\n\r\n- [ ] first\r\n- [x] second\r\n",
    });
  });

  it("accepts the ordered and blockquoted items the editor toggles", () => {
    const md = ["1. [ ] numbered", "", "> - [ ] quoted"].join("\n");
    expect(toggleTaskAtOrdinal(md, 0, "1. [ ] numbered")).toEqual({
      ok: true,
      checked: true,
      content: ["1. [x] numbered", "", "> - [ ] quoted"].join("\n"),
    });
    expect(toggleTaskAtOrdinal(md, 1, "> - [ ] quoted")).toEqual({
      ok: true,
      checked: true,
      content: ["1. [ ] numbered", "", "> - [x] quoted"].join("\n"),
    });
  });
});
