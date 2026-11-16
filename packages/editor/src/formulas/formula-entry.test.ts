import { describe, expect, it } from "vitest";

import { entryTextOf, pillFromEntry } from "@repo/editor/formulas/formula-entry";

const NONE: ReadonlySet<string> = new Set();

describe("what an entry spells", () => {
  it("is a formula, with or without the = a person may lead it with", () => {
    expect(pillFromEntry("2+2", NONE)).toStrictEqual({ source: "2+2" });
    expect(pillFromEntry(" =1000*12 ", NONE)).toStrictEqual({ source: "1000*12" });
  });

  it("is a named pill, whose source is a formula or any text", () => {
    expect(pillFromEntry("budget=5000", NONE)).toStrictEqual({ name: "budget", source: "5000" });
    expect(pillFromEntry("time = 9am", NONE)).toStrictEqual({ name: "time", source: "9am" });
  });

  it("is a formula over names only when a pill holds every one of them", () => {
    const names = new Set(["price", "qty"]);
    expect(pillFromEntry("price*qty", names)).toStrictEqual({ source: "price*qty" });
    expect(pillFromEntry("price*tax", names)).toBeNull();
    expect(pillFromEntry("hello", NONE)).toBeNull();
    expect(pillFromEntry("hello", new Set(["hello"]))).toStrictEqual({ source: "hello" });
  });

  it("names a pill ahead of the ones it reads", () => {
    expect(pillFromEntry("total=price*qty", NONE)).toStrictEqual({
      name: "total",
      source: "price*qty",
    });
  });

  it("is no pill for prose, a name with nothing after it, or nothing at all", () => {
    expect(pillFromEntry("hello world", NONE)).toBeNull();
    expect(pillFromEntry("total=", NONE)).toBeNull();
    expect(pillFromEntry("2+2|4", NONE)).toBeNull();
    expect(pillFromEntry("  ", NONE)).toBeNull();
  });

  it("reads back from a pill as it was typed", () => {
    expect(entryTextOf({ name: "budget", source: "5000" })).toBe("budget=5000");
    expect(entryTextOf({ source: "2+2" })).toBe("2+2");
  });
});
