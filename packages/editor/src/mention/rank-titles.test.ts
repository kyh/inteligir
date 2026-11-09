import { describe, expect, it } from "vitest";
import { rankTitles } from "./rank-titles";

const ranked = (titles: readonly string[], query: string): string[] =>
  rankTitles(
    titles.map((title) => ({ title })),
    query,
  ).map((target) => target.title);

describe(rankTitles, () => {
  it("answers every target in listing order for a blank query", () => {
    expect(ranked(["B", "A"], "")).toStrictEqual(["B", "A"]);
    expect(ranked(["B", "A"], "   ")).toStrictEqual(["B", "A"]);
  });

  it("ranks a title prefix, then a word start, then a substring", () => {
    expect(
      ranked(["Unroadmapped", "The road ahead", "Roadmap for 2027", "Other"], "road"),
    ).toStrictEqual(["Roadmap for 2027", "The road ahead", "Unroadmapped"]);
  });

  it("keeps the listing's order within a rank", () => {
    expect(ranked(["Road B", "Road A"], "road")).toStrictEqual(["Road B", "Road A"]);
  });

  it("matches case- and accent-blind", () => {
    expect(ranked(["Café", "Cafeteria"], "CAFE")).toStrictEqual(["Café", "Cafeteria"]);
  });

  it("matches typed words in any order at word starts", () => {
    expect(ranked(["Weekly review", "W"], "rev week")).toStrictEqual(["Weekly review"]);
  });

  it("reads the title alone, so a word it does not hold matches nothing", () => {
    expect(ranked(["Apple", "Pear"], "md")).toStrictEqual([]);
  });
});
