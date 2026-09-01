// deriveOpenDoc — pins the reachable state map of the open document. A flat set
// of view fields would allow illegal combinations (rich mode on a non-markdown
// file, a gate reason without a note); the union must cover exactly the
// reachable states and nothing else:
//   none                  — nothing open
//   loading               — intent path set, runtime hasn't loaded (also the
//                           rename-carry / vanish transient)
//   non-markdown          — loaded .html/.txt/… (always the raw textarea)
//   markdown + rich       — gate clear
//   markdown + raw/reason — gated

import { describe, expect, it } from "vitest";

import { deriveOpenDoc, openDocPath } from "@repo/editor/note/open-doc";
import type { GateReason } from "@repo/editor/markdown/markdown-doc";

const GATE: GateReason = { kind: "parse-error", line: 3, message: "Unexpected token" };

describe("deriveOpenDoc", () => {
  it("none when nothing is open", () => {
    const doc = deriveOpenDoc({
      openPath: null,
      loadedPath: null,
      rawReason: null,
    });
    expect(doc).toEqual({ kind: "none" });
    expect(openDocPath(doc)).toBeNull();
  });

  it("loading carries the INTENT path while the runtime reads", () => {
    const doc = deriveOpenDoc({
      openPath: "notes/a.md",
      loadedPath: null,
      rawReason: null,
    });
    expect(doc).toEqual({ kind: "loading", path: "notes/a.md" });
    expect(openDocPath(doc)).toBe("notes/a.md"); // sidebar/graph highlights
  });

  it("non-markdown for a loaded .html/.txt (mdx excluded from markdown)", () => {
    for (const path of ["demo.html", "notes/readme.txt", "component.mdx"]) {
      const doc = deriveOpenDoc({
        openPath: path,
        loadedPath: path,
        rawReason: null,
      });
      expect(doc).toEqual({ kind: "non-markdown", path });
    }
  });

  it("markdown + rich when the gate is clear", () => {
    const doc = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      rawReason: null,
    });
    expect(doc).toEqual({
      kind: "markdown",
      path: "a.md",
      surface: { mode: "rich" },
    });
  });

  it("markdown + raw with the gate's reason when the gate holds", () => {
    const doc = deriveOpenDoc({
      openPath: "a.md",
      loadedPath: "a.md",
      rawReason: GATE,
    });
    expect(doc).toEqual({
      kind: "markdown",
      path: "a.md",
      surface: { mode: "raw", reason: GATE },
    });
  });
});
