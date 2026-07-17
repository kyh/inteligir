import { describe, expect, it } from "vitest";

import {
  replaceLineGuarded,
  toggleCheckboxLine,
  toggleTaskAtOrdinal,
} from "../knowledge/guarded-line-edit";

const LF_DOC = ["# Title", "", "- [ ] task one", "- [x] task two", ""].join("\n");

describe("replaceLineGuarded", () => {
  it("byte-splices exactly one line, leaving every other byte untouched", () => {
    const result = replaceLineGuarded(LF_DOC, 2, "- [ ] task one", "REPLACED");
    expect(result).toEqual({
      ok: true,
      content: ["# Title", "", "REPLACED", "- [x] task two", ""].join("\n"),
    });
  });

  it("refuses with line-changed when ANY byte of the line differs", () => {
    expect(replaceLineGuarded(LF_DOC, 2, "- [ ] task one ", "x")).toEqual({
      ok: false,
      reason: "line-changed",
    });
    expect(replaceLineGuarded(LF_DOC, 2, "- [ ] Task one", "x")).toEqual({
      ok: false,
      reason: "line-changed",
    });
  });

  it("refuses with line-missing past EOF (and for negative indexes)", () => {
    expect(replaceLineGuarded(LF_DOC, 9, "- [ ] task one", "x")).toEqual({
      ok: false,
      reason: "line-missing",
    });
    expect(replaceLineGuarded("one line", 1, "", "x")).toEqual({
      ok: false,
      reason: "line-missing",
    });
    expect(replaceLineGuarded(LF_DOC, -1, "# Title", "x")).toEqual({
      ok: false,
      reason: "line-missing",
    });
  });

  it("expectedRaw excludes the terminator on BOTH LF and CRLF files (match side)", () => {
    const crlf = "# Title\r\n\r\n- [ ] crlf task\r\n";
    const result = replaceLineGuarded(crlf, 2, "- [ ] crlf task", "- [x] crlf task");
    expect(result).toEqual({ ok: true, content: "# Title\r\n\r\n- [x] crlf task\r\n" });
  });

  it("preserves mixed EOLs byte-exactly (only the addressed line changes)", () => {
    const mixed = "a\r\nb\rc\nd";
    const result = replaceLineGuarded(mixed, 2, "c", "C!");
    expect(result).toEqual({ ok: true, content: "a\r\nb\rC!\nd" });
  });

  it("handles the last line of a no-trailing-newline file", () => {
    const result = replaceLineGuarded("first\nlast", 1, "last", "LAST");
    expect(result).toEqual({ ok: true, content: "first\nLAST" });
  });
});

describe("toggleCheckboxLine", () => {
  it("flips [ ] to [x], touching only the marker char", () => {
    const result = toggleCheckboxLine(LF_DOC, 2, "- [ ] task one");
    expect(result).toEqual({
      ok: true,
      checked: true,
      content: ["# Title", "", "- [x] task one", "- [x] task two", ""].join("\n"),
    });
  });

  it("flips [x] and [X] back to [ ]", () => {
    const lower = toggleCheckboxLine(LF_DOC, 3, "- [x] task two");
    expect(lower).toMatchObject({ ok: true, checked: false });
    const upper = toggleCheckboxLine("- [X] shouty\n", 0, "- [X] shouty");
    expect(upper).toEqual({ ok: true, checked: false, content: "- [ ] shouty\n" });
  });

  it("preserves indentation and alternate bullets around the flip", () => {
    const doc = "  * [ ] nested star\n";
    const result = toggleCheckboxLine(doc, 0, "  * [ ] nested star");
    expect(result).toEqual({ ok: true, checked: true, content: "  * [x] nested star\n" });
  });

  it("toggles on a CRLF file without disturbing the terminators", () => {
    const crlf = "- [ ] a\r\n- [ ] b\r\n";
    const result = toggleCheckboxLine(crlf, 1, "- [ ] b");
    expect(result).toEqual({ ok: true, checked: true, content: "- [ ] a\r\n- [x] b\r\n" });
  });

  it("refuses non-checkbox expectedRaw as not-a-checkbox", () => {
    expect(toggleCheckboxLine("- plain bullet\n", 0, "- plain bullet")).toEqual({
      ok: false,
      reason: "not-a-checkbox",
    });
    // A bare checkbox with nothing after the `]` isn't a task line either.
    expect(toggleCheckboxLine("- [ ]\n", 0, "- [ ]")).toEqual({
      ok: false,
      reason: "not-a-checkbox",
    });
    expect(toggleCheckboxLine("x [ ] not a bullet\n", 0, "x [ ] not a bullet")).toEqual({
      ok: false,
      reason: "not-a-checkbox",
    });
  });

  it("still requires the raw-line guard to pass", () => {
    expect(toggleCheckboxLine(LF_DOC, 2, "- [ ] task one EDITED")).toEqual({
      ok: false,
      reason: "line-changed",
    });
    expect(toggleCheckboxLine(LF_DOC, 99, "- [ ] task one")).toEqual({
      ok: false,
      reason: "line-missing",
    });
  });

  it("double-toggle round-trips to the original bytes", () => {
    const once = toggleCheckboxLine(LF_DOC, 2, "- [ ] task one");
    if (!once.ok) throw new Error("first toggle failed");
    const twice = toggleCheckboxLine(once.content, 2, "- [x] task one");
    if (!twice.ok) throw new Error("second toggle failed");
    expect(twice.content).toBe(LF_DOC);
    expect(twice.checked).toBe(false);
  });
});

describe("toggleTaskAtOrdinal", () => {
  const DOC = [
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
    const result = toggleTaskAtOrdinal(DOC, 1, "- [ ] review PR");
    if (!result.ok) throw new Error("toggle failed");
    const lines = result.content.split("\n");
    expect(lines[4]).toBe("- [ ] review PR"); // ordinal 0 untouched
    expect(lines[8]).toBe("- [x] review PR"); // ordinal 1 flipped
  });

  it("survives lines shifting above the task (content-addressed, not line-addressed)", () => {
    const shifted = `inserted paragraph\n\n${DOC.slice(DOC.indexOf("- [ ] review PR"))}`;
    const result = toggleTaskAtOrdinal(shifted, 1, "- [ ] review PR");
    if (!result.ok) throw new Error("toggle failed");
    expect(result.content).toContain("## Later\n\n- [x] review PR");
  });

  it("refuses when the ordinal-th task's text drifted (line-changed)", () => {
    expect(toggleTaskAtOrdinal(DOC, 0, "- [ ] review PR again")).toEqual({
      ok: false,
      reason: "line-changed",
    });
  });

  it("refuses a vanished ordinal (line-missing)", () => {
    expect(toggleTaskAtOrdinal(DOC, 5, "- [ ] review PR")).toEqual({
      ok: false,
      reason: "line-missing",
    });
  });

  it("unchecks a checked task by ordinal", () => {
    const result = toggleTaskAtOrdinal(DOC, 2, "- [x] shipped");
    expect(result).toMatchObject({ ok: true, checked: false });
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
});
