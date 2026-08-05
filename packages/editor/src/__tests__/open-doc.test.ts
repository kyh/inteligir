// deriveOpenDoc — pins the reachable state map of the open document. The old
// flat view fields allowed illegal combinations (rich mode on a non-markdown
// file, a gate reason without a note); the union must cover exactly the
// reachable states and nothing else:
//   none                  — nothing open
//   loading               — intent path set, runtime hasn't loaded (also the
//                           rename-carry / vanish transient)
//   non-markdown          — loaded .html/.txt/… (always the raw textarea)
//   markdown + rich       — gate clear, user pick rich (the per-open default)
//   markdown + raw/null   — gate clear, user picked Raw
//   markdown + raw/reason — gated; a mid-session flip with a retained "rich"
//                           pick still derives raw (the pick is provider
//                           state, consumers only see the effective surface)

import { describe, expect, it } from "vitest";

import { deriveOpenDoc, openDocPath, richAvailable } from "@repo/editor/note/open-doc";
import type { GateReason } from "@repo/editor/markdown/markdown-doc";

const GATE: GateReason = { kind: "parse-error", line: 3, message: "Unexpected token" };

describe("deriveOpenDoc", () => {
  it("none when nothing is open", () => {
    const doc = deriveOpenDoc({
      openPath: null,
      loadedPath: null,
      content: "",
      rawReason: null,
      chosenMode: "raw",
    });
    expect(doc).toEqual({ kind: "none" });
    expect(openDocPath(doc)).toBeNull();
    expect(richAvailable(doc)).toBe(false);
  });

  it("loading carries the INTENT path while the runtime reads", () => {
    const doc = deriveOpenDoc({
      openPath: "notes/a.md",
      loadedPath: null,
      content: "",
      rawReason: null,
      chosenMode: "raw",
    });
    expect(doc).toEqual({ kind: "loading", path: "notes/a.md" });
    expect(openDocPath(doc)).toBe("notes/a.md"); // sidebar/graph highlights
    expect(richAvailable(doc)).toBe(false);
  });

  it("non-markdown for a loaded .html/.txt (mdx excluded from markdown)", () => {
    for (const path of ["demo.html", "notes/readme.txt", "component.mdx"]) {
      const doc = deriveOpenDoc({
        openPath: path,
        loadedPath: path,
        content: "<p>hi</p>",
        rawReason: null,
        chosenMode: "raw",
      });
      expect(doc).toEqual({ kind: "non-markdown", path });
      expect(richAvailable(doc)).toBe(false);
    }
  });

  it("markdown + rich when the gate is clear and the pick is rich", () => {
    const doc = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      content: "# Hi\n",
      rawReason: null,
      chosenMode: "rich",
    });
    expect(doc).toEqual({
      kind: "markdown",
      path: "a.md",
      isPrivate: false,
      surface: { mode: "rich" },
    });
    expect(richAvailable(doc)).toBe(true);
  });

  it("markdown + raw with reason:null when the user picked Raw on a rich-capable note", () => {
    const doc = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      content: "# Hi\n",
      rawReason: null,
      chosenMode: "raw",
    });
    expect(doc).toEqual({
      kind: "markdown",
      path: "a.md",
      isPrivate: false,
      surface: { mode: "raw", reason: null },
    });
    expect(richAvailable(doc)).toBe(true); // the header toggle stays offered
  });

  it("markdown + gated raw regardless of the retained pick (mid-session flip)", () => {
    for (const chosenMode of ["raw", "rich"] as const) {
      const doc = deriveOpenDoc({
        openPath: "a.md",
        loadedPath: "a.md",
        content: "left {unclosed\n",
        rawReason: GATE,
        chosenMode,
      });
      expect(doc).toEqual({
        kind: "markdown",
        path: "a.md",
        isPrivate: false,
        surface: { mode: "raw", reason: GATE },
      });
      expect(richAvailable(doc)).toBe(false);
    }
  });

  it("isPrivate reads the LIVE buffer's frontmatter, markdown only", () => {
    const priv = "---\nprivate: true\n---\n\n# Secret\n";
    const md = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      content: priv,
      rawReason: null,
      chosenMode: "rich",
    });
    expect(md.kind === "markdown" && md.isPrivate).toBe(true);
    // The strictly-"private" UI semantics: unreadable frontmatter shows no lock.
    const broken = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      content: "---\nprivate: [unclosed\n---\n",
      rawReason: null,
      chosenMode: "rich",
    });
    expect(broken.kind === "markdown" && broken.isPrivate).toBe(false);
  });
});
