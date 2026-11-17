import { describe, expect, it } from "vitest";

import { excerptAround, passageIn, termMatch } from "./search-excerpt";
import { planSearchQuery } from "./search-query";

const passageOf = (text: string, query: string): string | null =>
  passageIn(text, termMatch(planSearchQuery(query)[0]?.terms ?? []));

describe("a hit's passage", () => {
  it("is the first line holding a term, its stem or its typed prefix, across terminators", () => {
    const body = "# Title\r\n\r\nnothing here\rI was exhausted lately\nmore\n";
    expect(passageOf(body, "exhausting")).toBe("I was exhausted lately");
    expect(passageOf(body, "exha")).toBe("I was exhausted lately");
    expect(passageOf(body, "absent")).toBeNull();
  });

  it("holds the match however far into its line it sits", () => {
    const line = `${"filler ".repeat(60)}the needle sits here${" and more".repeat(30)}`;
    expect(passageOf(line, "needle")).toBe(
      `… ${"filler ".repeat(5)}the needle sits here${" and more".repeat(7)} and mo…`,
    );
  });

  it("finds a word written with marks by the spelling the index folds it to", () => {
    expect(passageOf("una acción rápida", "accion")).toBe("una acción rápida");
  });
});

describe("the excerpt around a match", () => {
  it("clips both sides and marks the cut", () => {
    const line = `${"a".repeat(60)}NEEDLE${"b".repeat(120)}`;
    expect(excerptAround(line, { length: 6, offset: 60 })).toBe(
      `…${"a".repeat(40)}NEEDLE${"b".repeat(80)}…`,
    );
  });
});
