import { describe, expect, it } from "vitest";

import { deriveOpenDoc, openDocPath } from "@repo/editor/note/open-doc";

describe(deriveOpenDoc, () => {
  it("none when nothing is open", () => {
    const doc = deriveOpenDoc({ loadedPath: null, openPath: null });
    expect(doc).toStrictEqual({ kind: "none" });
    expect(openDocPath(doc)).toBeNull();
  });

  it("loading carries the INTENT path while the runtime reads", () => {
    const doc = deriveOpenDoc({ loadedPath: null, openPath: "notes/a.md" });
    expect(doc).toStrictEqual({ kind: "loading", path: "notes/a.md" });
    expect(openDocPath(doc)).toBe("notes/a.md");
  });

  it("non-markdown for a loaded .html/.txt (mdx excluded from markdown)", () => {
    for (const path of ["demo.html", "notes/readme.txt", "component.mdx"]) {
      expect(deriveOpenDoc({ loadedPath: path, openPath: path })).toStrictEqual({
        kind: "non-markdown",
        path,
      });
    }
  });

  it("markdown for a loaded note, whatever its bytes", () => {
    expect(deriveOpenDoc({ loadedPath: "a.md", openPath: "a.md" })).toStrictEqual({
      kind: "markdown",
      path: "a.md",
    });
  });
});
