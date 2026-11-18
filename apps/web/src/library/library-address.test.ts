import { describe, expect, it } from "vitest";

import { libraryHref, parseLibraryAddress } from "./library-address";

const FOLDER = "01a0f4c2-c400-78d9-a955-7935ec13d6d5";

const scopeAt = (search: string) =>
  parseLibraryAddress("/library", new URLSearchParams(search)).scope;

describe("the tab's address", () => {
  it("names a scope by one parameter, and reads back as the address it was written as", () => {
    for (const search of [`folder=${FOLDER}`, "tag=design", "scope=unsorted", "scope=deleted"]) {
      const address = parseLibraryAddress("/library", new URLSearchParams(search));
      expect(libraryHref(address)).toBe(`/library?${search}`);
    }
  });

  it("reads a scope the listing would refuse as no scope", () => {
    expect(scopeAt("folder=Reading")).toStrictEqual({ kind: "all" });
    expect(scopeAt(`tag=${"t".repeat(1001)}`)).toStrictEqual({ kind: "all" });
    expect(scopeAt("scope=everything")).toStrictEqual({ kind: "all" });
    expect(scopeAt(`folder=${FOLDER}&tag=design`)).toStrictEqual({ kind: "all" });
  });
});
