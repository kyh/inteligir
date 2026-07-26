import { describe, expect, it } from "vitest";

import { scanTaskItems } from "@repo/notes/knowledge/link-extract";

import { findTaskLine } from "../delegation/find-task-line";

const DOC = [
  "# Project",
  "",
  "## This week",
  "",
  "- [ ] book the flight", // index 0
  "- [x] already done", //    index 1 (checked)
  "- [ ] email the team", //  index 2
  "",
  "## Backlog",
  "",
  "- [ ] book the flight", // index 3 — same label, different position
].join("\n");

describe("findTaskLine", () => {
  it("resolves a checkbox by its ordinal", () => {
    const m = findTaskLine(DOC, 0);
    expect(m?.text).toBe("book the flight");
    expect(m?.lineText).toBe("- [ ] book the flight");
    expect(m?.heading).toBe("This week");
  });

  it("counts checked boxes in the ordinal but won't delegate one", () => {
    expect(findTaskLine(DOC, 1)).toBeNull(); // index 1 is already checked
    expect(findTaskLine(DOC, 2)?.text).toBe("email the team");
  });

  it("distinguishes duplicate labels purely by position", () => {
    expect(findTaskLine(DOC, 0)?.heading).toBe("This week");
    expect(findTaskLine(DOC, 3)?.heading).toBe("Backlog");
  });

  it("returns null for an out-of-range ordinal", () => {
    expect(findTaskLine(DOC, 4)).toBeNull();
  });

  it("matches -, *, + bullets and CRLF/CR line endings", () => {
    expect(findTaskLine("* [ ] star", 0)?.text).toBe("star");
    expect(findTaskLine("+ [ ] plus", 0)?.text).toBe("plus");
    expect(findTaskLine("# H\r\n\r\n- [ ] crlf", 0)?.text).toBe("crlf");
  });

  it("does not count checkbox-like lines inside fenced code", () => {
    const md = ["```", "- [ ] not a task", "```", "", "- [ ] real task"].join("\n");
    expect(findTaskLine(md, 0)?.text).toBe("real task");
    expect(findTaskLine(md, 1)).toBeNull();
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
    expect(findTaskLine(md, 0)?.text).toBe("real");
    expect(findTaskLine(md, 1)).toBeNull();
  });

  it("ignores heading-like lines inside fenced code for context", () => {
    const md = ["## Real heading", "", "```", "## fake heading", "```", "", "- [ ] task"].join(
      "\n",
    );
    expect(findTaskLine(md, 0)?.heading).toBe("Real heading");
  });

  it("counts a 4-space-indented checkbox (no indented code in the canonical flavor)", () => {
    // The MDX vocabulary has no indented-code construct, so the editor renders
    // this line as a live task — scanTaskItems reads the same grammar and the
    // ordinal counts it. A parser that treated the indent as a code block
    // would skip the line and desync every later ordinal from the renderer.
    const md = ["Notes", "", "    - [ ] alpha", "", "- [ ] real"].join("\n");
    expect(findTaskLine(md, 0)?.text).toBe("alpha");
    expect(findTaskLine(md, 1)?.text).toBe("real");
    expect(findTaskLine(md, 2)).toBeNull();
  });

  it("counts nested task items in document order", () => {
    const md = ["- [ ] parent", "  - [ ] child", "- [ ] sibling"].join("\n");
    expect(findTaskLine(md, 0)?.text).toBe("parent");
    expect(findTaskLine(md, 1)?.text).toBe("child");
    expect(findTaskLine(md, 2)?.text).toBe("sibling");
  });

  it("doesn't count a plain bullet that follows a task in the same list", () => {
    // remark gives the plain bullet checked:null (and Plate a phantom todo with
    // no `checked`) — both exclude it, so the ordinal stays aligned.
    const md = ["- [ ] real one", "- plain", "- [x] real two"].join("\n");
    expect(findTaskLine(md, 0)?.text).toBe("real one");
    expect(findTaskLine(md, 1)).toBeNull(); // index 1 = "real two", already checked
    expect(findTaskLine(md, 2)).toBeNull(); // out of range (only 2 task items)
  });

  it("doesn't count an empty checkbox (Plate renders `- [ ] ` as a plain bullet)", () => {
    // A bare checkbox with no text deserializes to a non-todo in Plate, so the
    // renderer's todoIndex skips it — main must too, or the ordinals desync.
    const md = ["- [ ] ", "- [ ] real task"].join("\n");
    expect(findTaskLine(md, 0)?.text).toBe("real task");
    expect(findTaskLine(md, 1)).toBeNull();
  });

  it("handles a task with no heading above it", () => {
    expect(findTaskLine("- [ ] lonely", 0)?.heading).toBeNull();
  });

  it("keeps inline markdown verbatim in the resolved text (no normalization)", () => {
    expect(findTaskLine("- [ ] **buy** milk", 0)?.text).toBe("**buy** milk");
  });

  it("ignores checkbox-shaped lines inside YAML frontmatter (ordinal-drift fix)", () => {
    // Without remark-frontmatter the leading `---` parses as a thematic break
    // and the YAML's `- [ ]` line would consume ordinal 0 — while scanDoc and
    // the Plate pipeline (both frontmatter-aware) skip it. Pin the fix.
    const md = ["---", "checklist:", "  - [ ] yaml lookalike", "---", "", "- [ ] real task"].join(
      "\n",
    );
    expect(findTaskLine(md, 0)?.text).toBe("real task");
    expect(findTaskLine(md, 1)).toBeNull();
  });
});

describe("findTaskLine ↔ scanTaskItems ordinal lockstep", () => {
  // The three counters (findTaskLine here, core scanTaskItems feeding the
  // projection + guarded toggle, Plate's todoIndex) must agree by POSITION.
  // This fixture stresses every divergence candidate: frontmatter lookalikes,
  // fenced code, an indented item (a LIVE task — the canonical MDX flavor has
  // no indented code), plain bullets, empty checkboxes, nesting, checked
  // items, alternate bullet chars, and duplicate labels.
  const FIXTURE = [
    "---",
    "tasks:",
    "  - [ ] frontmatter lookalike",
    "---",
    "",
    "# Plan",
    "",
    "- [ ] alpha",
    "- plain bullet",
    "- [ ] ",
    "- [x] beta",
    "  - [ ] nested gamma",
    "",
    "```",
    "- [ ] fenced lookalike",
    "```",
    "",
    "    - [ ] indented live task", // indented ≠ code in the canonical flavor
    "",
    "* [ ] delta",
    "+ [ ] alpha", // duplicate label, distinct ordinal
  ].join("\n");

  it("counts the same items at the same lines, ordinal for ordinal", () => {
    const tasks = scanTaskItems(FIXTURE);
    expect(tasks.map((t) => t.text)).toEqual([
      "alpha",
      "beta",
      "nested gamma",
      "indented live task",
      "delta",
      "alpha",
    ]);
    for (const task of tasks) {
      if (task.checked) continue; // findTaskLine refuses checked items by design
      const match = findTaskLine(FIXTURE, task.ordinal);
      expect(match).not.toBeNull();
      expect(match?.lineText).toBe(task.raw);
      expect(match?.text).toBe(task.text);
    }
    // Past-the-end agrees too.
    expect(findTaskLine(FIXTURE, tasks.length)).toBeNull();
  });
});
