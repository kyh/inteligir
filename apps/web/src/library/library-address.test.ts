import { describe, expect, it } from "vitest";

import {
  isViewAt,
  libraryHref,
  parseLibraryAddress,
  scopeAddress,
  viewAddress,
} from "./library-address";

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

  it("links a scope with nothing open over it by its one parameter, All items by none", () => {
    expect(libraryHref(scopeAddress({ parentId: FOLDER, kind: "parent" }))).toBe(
      `/library?folder=${FOLDER}`,
    );
    expect(libraryHref(scopeAddress({ kind: "deleted" }))).toBe("/library?scope=deleted");
    expect(libraryHref(scopeAddress({ kind: "all" }))).toBe("/library");
  });

  it("reads a scope the listing would refuse as no scope", () => {
    expect(scopeAt("folder=Reading")).toStrictEqual({ kind: "all" });
    expect(scopeAt(`tag=${"t".repeat(1001)}`)).toStrictEqual({ kind: "all" });
    expect(scopeAt("scope=everything")).toStrictEqual({ kind: "all" });
    expect(scopeAt(`folder=${FOLDER}&tag=design`)).toStrictEqual({ kind: "all" });
  });

  it("carries a search's words beside its scope and kind, and none blank", () => {
    const address = parseLibraryAddress(
      "/library",
      new URLSearchParams("tag=design&kind=pdf&q=grid"),
    );

    expect(address).toMatchObject({ kind: "pdf", words: "grid" });
    expect(libraryHref(address)).toBe("/library?tag=design&kind=pdf&q=grid");
    expect(parseLibraryAddress("/library", new URLSearchParams("q=%20")).words).toBeNull();
  });

  it("opens a saved view at its address, and lights it there alone", () => {
    const view = {
      id: FOLDER,
      kinds: ["pdf" as const],
      name: "Grid papers",
      scope: { kind: "tag" as const, tag: "design" },
      words: "grid",
    };

    const at = viewAddress(view);
    expect(libraryHref(at)).toBe("/library?tag=design&kind=pdf&q=grid");
    expect(isViewAt(view, at)).toBe(true);
    expect(isViewAt(view, { ...at, words: null })).toBe(false);
    expect(isViewAt(view, { ...at, openItem: FOLDER })).toBe(false);
  });
});
