// The composed block is a GOLDEN: it is the whole of what the model is told
// about the user's screen, it costs tokens on every turn that carries one, and
// a silent rewording is the kind of change nobody notices until the agent
// stops resolving "this". So the bytes are pinned, the cap is pinned, and the
// cap's boundary is pinned against the failure `headCapUtf8` exists for.

import { VIEW_CONTEXT_EXCERPT_MAX_BYTES, type ViewContext } from "@repo/domain/view-context";
import { describe, expect, it } from "vitest";
import { composeViewContextBlock, turnPromptInput } from "../view-context-prompt";

const REVISION = "b".repeat(64);

function docContext(selection?: { from: number; to: number; text: string }): ViewContext {
  return {
    surface: "doc",
    resource: "Notes/Plans.md",
    revision: REVISION,
    ...(selection === undefined ? {} : { selection }),
  };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("composeViewContextBlock", () => {
  it("names the file, the revision and the selection", () => {
    const block = composeViewContextBlock(
      docContext({ from: 12, to: 41, text: "First paragraph to delegate." }),
    );
    expect(block).toBe(
      [
        `The user sent this while looking at Notes/Plans.md in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${REVISION} when they sent it; if it no longer does, it changed afterwards.`,
        "They had this selected (characters 12–41 of that revision — the quoted text is authoritative, the offsets are advisory):",
        "> First paragraph to delegate.",
      ].join("\n\n"),
    );
  });

  it("says only which file when nothing was selected", () => {
    const block = composeViewContextBlock(docContext());
    expect(block).toBe(
      `The user sent this while looking at Notes/Plans.md in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${REVISION} when they sent it; if it no longer does, it changed afterwards.`,
    );
  });

  it("quotes every line of a multi-line selection", () => {
    const block = composeViewContextBlock(docContext({ from: 0, to: 9, text: "one\n\nthree" }));
    expect(block.endsWith("> one\n> \n> three")).toBe(true);
  });

  it("caps an oversized selection and says it cut it", () => {
    const text = "x".repeat(VIEW_CONTEXT_EXCERPT_MAX_BYTES * 3);
    const block = composeViewContextBlock(docContext({ from: 0, to: text.length, text }));
    expect(block).toContain(`cut here to its first ${VIEW_CONTEXT_EXCERPT_MAX_BYTES} bytes`);
    const excerpt = block.slice(block.lastIndexOf("\n\n") + 2).replace("> ", "");
    expect(utf8Length(excerpt)).toBe(VIEW_CONTEXT_EXCERPT_MAX_BYTES);
  });

  it("cuts on a code-point boundary, not a UTF-16 one", () => {
    // One ASCII byte then 4-byte code points, so the budget runs out three
    // bytes into the last one. Slicing by `string.length` would halve its
    // surrogate pair and hand the model U+FFFD.
    const emoji = "😀";
    const text = `a${emoji.repeat(VIEW_CONTEXT_EXCERPT_MAX_BYTES / 4)}`;
    const block = composeViewContextBlock(docContext({ from: 0, to: text.length, text }));
    const excerpt = block.slice(block.lastIndexOf("\n\n") + 2).replace("> ", "");
    expect(excerpt).not.toContain("�");
    expect(Array.from(excerpt)).toEqual(["a", ...Array<string>(499).fill(emoji)]);
    expect(utf8Length(excerpt)).toBeLessThanOrEqual(VIEW_CONTEXT_EXCERPT_MAX_BYTES);
  });
});

describe("turnPromptInput", () => {
  it("carries the user's text alone when there is no context", () => {
    expect(turnPromptInput("make this shorter", undefined)).toEqual([
      { type: "text", text: "make this shorter" },
    ]);
  });

  it("leads with the block and leaves the user's text its own element", () => {
    const input = turnPromptInput("make this shorter", docContext());
    expect(input).toHaveLength(2);
    expect(input[0]?.text).toBe(composeViewContextBlock(docContext()));
    // The user's own bytes, unmangled — the reason the block is a separate
    // element rather than a prefix.
    expect(input[1]).toEqual({ type: "text", text: "make this shorter" });
  });
});
