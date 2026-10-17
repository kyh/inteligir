import { describe, expect, it } from "vitest";
import { parseByteRange, rangeApplies } from "../byte-range";

describe("parseByteRange", () => {
  it.each([
    ["bytes=0-1", 100, { end: 1, kind: "range", start: 0 }],
    ["bytes=10-", 100, { end: 99, kind: "range", start: 10 }],
    ["bytes=-10", 100, { end: 99, kind: "range", start: 90 }],
    ["bytes=-500", 100, { end: 99, kind: "range", start: 0 }],
    ["bytes=90-500", 100, { end: 99, kind: "range", start: 90 }],
    ["bytes = 5 - 6", 100, { end: 6, kind: "range", start: 5 }],
    ["bytes=99-99", 100, { end: 99, kind: "range", start: 99 }],
  ] as const)("reads %s of a %d-byte file", (header, size, expected) => {
    expect(parseByteRange(header, size)).toEqual(expected);
  });

  it.each([
    ["bytes=100-", 100],
    ["bytes=200-300", 100],
    ["bytes=-0", 100],
    ["bytes=0-", 0],
    ["bytes=-5", 0],
  ] as const)("calls %s of a %d-byte file unsatisfiable", (header, size) => {
    expect(parseByteRange(header, size)).toEqual({ kind: "unsatisfiable" });
  });

  it.each([
    undefined,
    "",
    "bytes=",
    "bytes=-",
    "items=0-1",
    "bytes=0-1,5-6",
    "bytes=5-2",
    "bytes=a-b",
    "bytes=0-1 trailing",
    `bytes=0-${"9".repeat(20)}`,
  ])("answers %s whole, as a range it does not read", (header) => {
    expect(parseByteRange(header, 100)).toEqual({ kind: "whole" });
  });
});

describe("rangeApplies", () => {
  it("applies with no if-range, or one naming the current etag", () => {
    expect(rangeApplies(undefined, '"a-1"')).toBe(true);
    expect(rangeApplies('"a-1"', '"a-1"')).toBe(true);
  });

  it("does not apply to a stale etag or a date, which names no version of ours", () => {
    expect(rangeApplies('"a-0"', '"a-1"')).toBe(false);
    expect(rangeApplies("Wed, 21 Oct 2015 07:28:00 GMT", '"a-1"')).toBe(false);
  });
});
