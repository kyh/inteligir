import { describe, expect, it } from "vitest";

import { checkboxMarkerAt, splitLines } from "../knowledge/source-lines";

// The one split rule, driven over the EOL flavors that actually break it. A
// line's content excludes its terminator, and the task scan records a
// checkbox's `raw` under exactly this reading — so a doc whose line count or
// line bytes come back wrong here desyncs every ordinal built on top.
describe("splitLines", () => {
  it("excludes every terminator flavor, mixed endings included", () => {
    expect(splitLines("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\rb\rc")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("yields a trailing empty line for a file that ends in a terminator", () => {
    expect(splitLines("trailing\n")).toEqual(["trailing", ""]);
    expect(splitLines("a\r\nb\r\nc\r\n")).toEqual(["a", "b", "c", ""]);
    expect(splitLines("\n")).toEqual(["", ""]);
  });

  it("reads a file with no terminator at all as one line", () => {
    expect(splitLines("only")).toEqual(["only"]);
    expect(splitLines("")).toEqual([""]);
  });
});

// The one grammar's own surface: where the state char sits and what it holds.
// The editor's click-to-toggle dispatches a one-char change at checkboxIndex,
// so the offset is load-bearing, not informational.
describe("checkboxMarkerAt", () => {
  it("locates the state char across bullet, ordered and blockquoted forms", () => {
    expect(checkboxMarkerAt("- [ ] task")).toEqual({ checkboxIndex: 3, checked: false });
    expect(checkboxMarkerAt("  * [x] nested")).toEqual({ checkboxIndex: 5, checked: true });
    expect(checkboxMarkerAt("1. [ ] numbered")).toEqual({ checkboxIndex: 4, checked: false });
    expect(checkboxMarkerAt("12) [X] wide marker")).toEqual({ checkboxIndex: 5, checked: true });
    expect(checkboxMarkerAt("> - [ ] quoted")).toEqual({ checkboxIndex: 5, checked: false });
    expect(checkboxMarkerAt("> > - [x] nested quote")).toEqual({ checkboxIndex: 7, checked: true });
  });

  it("refuses non-task lines", () => {
    expect(checkboxMarkerAt("- plain bullet")).toBeNull();
    expect(checkboxMarkerAt("x [ ] not a bullet")).toBeNull();
    expect(checkboxMarkerAt("- [ ]")).toBeNull(); // nothing after the `]`
    expect(checkboxMarkerAt("- [y] not a state")).toBeNull();
    expect(checkboxMarkerAt("> quoted prose")).toBeNull();
  });
});
