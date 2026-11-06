import { describe, expect, it } from "vitest";

import { splitLinesKeepingTerminators } from "./source-lines";

describe("splitLinesKeepingTerminators", () => {
  it("keeps every terminator flavor between the lines, mixed endings included", () => {
    expect(splitLinesKeepingTerminators("a\r\nb\rc\nd")).toEqual([
      "a",
      "\r\n",
      "b",
      "\r",
      "c",
      "\n",
      "d",
    ]);
  });

  it("joins back byte-exact, a trailing terminator and none alike", () => {
    for (const source of ["trailing\n", "a\r\nb\r\nc\r\n", "\n", "only", ""]) {
      expect(splitLinesKeepingTerminators(source).join("")).toBe(source);
    }
  });
});
