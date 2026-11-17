import { describe, expect, it } from "vitest";
import { listingPage } from "./library-query";

const NONE = new Set<never>();

describe("the Library's question to the listing", () => {
  it("asks a scope's first page of every kind while nothing narrows it", () => {
    expect(listingPage({ kinds: NONE, scope: { kind: "all" }, words: "" })).toStrictEqual({
      cursor: undefined,
      kinds: undefined,
      limit: 100,
      scope: { kind: "all" },
      words: undefined,
    });
  });

  it("narrows to the kinds chosen, and searches the words in the scope it lists", () => {
    const filter = {
      kinds: new Set(["link" as const]),
      scope: { kind: "deleted" as const },
      words: "draft",
    };
    expect(listingPage(filter, 200)).toStrictEqual({
      cursor: 200,
      kinds: ["link"],
      limit: 100,
      scope: { kind: "deleted" },
      words: "draft",
    });
  });
});
