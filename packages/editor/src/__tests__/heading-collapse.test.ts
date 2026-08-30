// Folds are VIEW state keyed by note. Opening another note must not carry the
// previous one's folded sections onto it, and persisting one note's folds must
// not drop the record every other note's live in — the store holds only the
// notes this process opened, so a whole-record write from it alone would erase
// the rest.

import { afterEach, describe, expect, it, vi } from "vitest";

import { headingCollapseKeys, toggleHeadingCollapse } from "@repo/editor/heading-collapse";

/** localStorage as jsdom-free tests see it: a plain map, readable back. */
function stubStorage(): Map<string, string> {
  const written = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => written.get(key) ?? null,
    setItem: (key: string, value: string) => {
      written.set(key, value);
    },
    removeItem: (key: string) => {
      written.delete(key);
    },
  });
  return written;
}

describe("heading collapse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("folds under the note that was toggled and no other", () => {
    stubStorage();
    toggleHeadingCollapse("notes/a.md", "1:Intro:0");

    expect([...headingCollapseKeys("notes/a.md")]).toEqual(["1:Intro:0"]);
    expect([...headingCollapseKeys("notes/b.md")]).toEqual([]);
  });

  it("persists every note's folds in one record, keyed by path", () => {
    const written = stubStorage();
    toggleHeadingCollapse("notes/c.md", "1:Intro:0");
    toggleHeadingCollapse("notes/d.md", "2:Details:0");

    expect(written.size).toBe(1);
    const stored: unknown = JSON.parse([...written.values()][0] ?? "{}");
    expect(stored).toEqual({ "notes/c.md": ["1:Intro:0"], "notes/d.md": ["2:Details:0"] });
  });
});
