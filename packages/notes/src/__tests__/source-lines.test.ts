import { describe, expect, it } from "vitest";

import { replaceLineGuarded, splitLines, toggleCheckboxLine } from "../knowledge/source-lines";

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

// THE reason both readings live in one module. `splitLines` reads a line as a
// value and the guarded write reads it as a span; every byte-exact edit in the
// product rides on the two naming the same bytes. Drive it over the EOL flavors
// that actually break: CRLF, a bare CR, a mix, no trailing terminator, and a
// trailing one (which yields a final empty line by contract).
describe("splitLines ↔ the guarded write's own reading", () => {
  const DOCS = [
    "a\nb\nc",
    "a\r\nb\r\nc\r\n",
    "a\rb\rc",
    "a\r\nb\rc\nd",
    "",
    "\n",
    "only",
    "trailing\n",
  ];

  it("names the same bytes for every line of every EOL flavor", () => {
    for (const doc of DOCS) {
      const lines = splitLines(doc);
      for (const [index, line] of lines.entries()) {
        // The guard passes only if the span the write scans out holds exactly
        // the bytes the split handed back.
        expect(replaceLineGuarded(doc, index, line, line)).toEqual({ ok: true, content: doc });
      }
      // And they agree about where the file STOPS.
      expect(replaceLineGuarded(doc, lines.length, "", "x")).toEqual({
        ok: false,
        reason: "line-missing",
      });
    }
  });
});
