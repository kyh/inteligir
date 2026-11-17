import { describe, expect, it } from "vitest";

import { displaysOf } from "./displays";
import { evaluateExpression, isPillName, namesIn, parseExpression, renameIn } from "./expression";
import { formatResult } from "./format-result";

const evaluate = (source: string): number | null => {
  const tree = parseExpression(source);
  return tree === null ? null : evaluateExpression(tree, () => null);
};

const names = (source: string): string[] | null => {
  const tree = parseExpression(source);
  return tree === null ? null : namesIn(tree);
};

describe("the formula grammar (the prompt's own examples)", () => {
  it("computes plain arithmetic", () => {
    expect(evaluate("2+2")).toBe(4);
    expect(evaluate("1000*12")).toBe(12_000);
    expect(evaluate("28")).toBe(28);
  });

  it("honors precedence and parentheses", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("10-2-3")).toBe(5);
    expect(evaluate("12/4/3")).toBe(1);
  });

  it("parses $, thousands commas, %, and k/m/b suffixes", () => {
    expect(evaluate("$5,000")).toBe(5000);
    expect(evaluate("1,234.5")).toBe(1234.5);
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("2k")).toBe(2000);
    expect(evaluate("1.5m")).toBe(1_500_000);
    expect(evaluate("2b")).toBe(2_000_000_000);
  });

  it("accepts uppercase suffixes and suffix-percent composition", () => {
    expect(evaluate("5K")).toBe(5000);
    expect(evaluate("1.5M")).toBe(1_500_000);
    expect(evaluate("5k%")).toBe(50);
  });

  it("allows unary minus as a factor", () => {
    expect(evaluate("-5+8")).toBe(3);
    expect(evaluate("2*-3")).toBe(-6);
  });

  it("reads a word as the name of a pill, and a number's suffix as the number's", () => {
    expect(names("price*qty")).toStrictEqual(["price", "qty"]);
    expect(names("(base_size+h1)/2")).toStrictEqual(["base_size", "h1"]);
    expect(names("rate-fee")).toStrictEqual(["rate", "fee"]);
    expect(names("2k*k")).toStrictEqual(["k"]);
    expect(names("time")).toStrictEqual(["time"]);
  });

  it("refuses what it excludes, which is text", () => {
    expect(parseExpression("9am")).toBeNull();
    expect(parseExpression("9am-930am")).toBeNull();
    expect(parseExpression("sum(1,2)")).toBeNull();
    expect(parseExpression("2^3")).toBeNull();
    expect(parseExpression("price qty")).toBeNull();
    // malformed thousands group
    expect(parseExpression("1,23")).toBeNull();
    expect(parseExpression("")).toBeNull();
  });

  it("has no value for a division by zero, or for a name with none", () => {
    expect(evaluate("1/0")).toBeNull();
    expect(evaluate("price*2")).toBeNull();
  });

  it("takes a name a source can spell, and no other", () => {
    expect(["budget", "base_size", "h1"].every(isPillName)).toBe(true);
    expect(["", "1st", "rate-fee", "my total", "total="].some(isPillName)).toBe(false);
  });
});

describe("a name respelled in a source", () => {
  it("changes every read of it, and no longer name that holds it", () => {
    expect(renameIn("price*qty + price", "price", "cost")).toBe("cost*qty + cost");
    expect(renameIn("prices*price_2", "price", "cost")).toBe("prices*price_2");
    expect(renameIn("2k*k", "k", "kilo")).toBe("2k*kilo");
  });

  it("leaves text as it was written", () => {
    expect(renameIn("price is high", "price", "cost")).toBe("price is high");
  });
});

describe("result formatting", () => {
  it("uses thousands separators and at most two decimals, undecorated", () => {
    expect(formatResult(12_000)).toBe("12,000");
    expect(formatResult(4)).toBe("4");
    expect(formatResult(1 / 3)).toBe("0.33");
    expect(formatResult(5000)).toBe("5,000");
    expect(formatResult(-0)).toBe("0");
  });
});

describe("what an item's pills show", () => {
  it("is each formula's value", () => {
    expect(displaysOf([{ source: "2+2" }, { source: "1000*12" }])).toStrictEqual(["4", "12,000"]);
  });

  it("reads another pill by its name, wherever in the item it stands", () => {
    expect(
      displaysOf([
        { name: "total", source: "price*qty" },
        { name: "price", source: "5" },
        { name: "qty", source: "3" },
        { source: "total+1" },
      ]),
    ).toStrictEqual(["15", "5", "3", "16"]);
  });

  it("is the text of a source that is no formula, and of a pill that only names one", () => {
    expect(
      displaysOf([{ name: "time", source: "9am" }, { source: "time" }, { source: "time+1" }]),
    ).toStrictEqual(["9am", "9am", "time+1"]);
  });

  it("is the pill's own source where it has no value", () => {
    expect(displaysOf([{ source: "price*2" }, { source: "1/0" }])).toStrictEqual([
      "price*2",
      "1/0",
    ]);
  });

  it("is the source of each pill in a loop, and of each that reads one", () => {
    expect(
      displaysOf([
        { name: "a", source: "b+1" },
        { name: "b", source: "a+1" },
        { source: "a*2" },
        { name: "c", source: "d" },
        { name: "d", source: "c" },
      ]),
    ).toStrictEqual(["b+1", "a+1", "a*2", "d", "c"]);
  });

  it("reads the first pill to hold a name two of them hold", () => {
    expect(
      displaysOf([{ name: "x", source: "1" }, { name: "x", source: "2" }, { source: "x*10" }]),
    ).toStrictEqual(["1", "2", "10"]);
  });
});
