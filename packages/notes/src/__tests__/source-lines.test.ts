import { describe, expect, it } from "vitest";

import { splitLines } from "../knowledge/source-lines";

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
