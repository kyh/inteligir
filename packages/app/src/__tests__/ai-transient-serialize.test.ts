// Transient-AI byte safety — an autosave firing MID-SESSION (AI stream,
// unresolved suggestions, visible ghost) must write clean bytes: no ai /
// suggestion remnants, pending insertions absent, the user's original text
// intact (reject-equivalent output). Resolution then serializes the settled
// document with no leftovers.

import { describe, expect, it } from "vitest";
import { createSlateEditor, type Value } from "platejs";
import { getTransientSuggestionKey } from "@platejs/suggestion";
import { serializeMd } from "@platejs/markdown";

import { AI_MARK } from "@repo/app/editor/ai/ai-mark";
import {
  applyEditSuggestions,
  resolveAllSuggestions,
  resolveSuggestion,
  transientSuggestionIds,
} from "@repo/app/editor/ai/suggestions";
import { TRANSIENT_SUGGESTION_KEY, hasTransientAiState } from "@repo/app/editor/ai/transient";
import { EDITOR_KIT } from "@repo/app/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/app/editor/markdown/markdown-doc";

function seedEditor(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}

function serialize(editor: ReturnType<typeof seedEditor>): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

function parsedValue(md: string): Value {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("replacement must parse");
  return parsed.value;
}

const ORIGINAL = "The cat is black.\n\nKeep me unchanged.\n";
const REWRITE = "The dog was black.\n\nKeep me unchanged.\n\nA whole new paragraph.\n";

describe("transient key pin", () => {
  it("matches @platejs/suggestion's transient marker", () => {
    expect(TRANSIENT_SUGGESTION_KEY).toBe(getTransientSuggestionKey());
  });
});

describe("mid-stream autosave (ai mark)", () => {
  it("streamed ai-marked text never serializes", () => {
    const editor = seedEditor(ORIGINAL);
    const before = serialize(editor);
    editor.tf.select(editor.api.end([]));
    editor.tf.addMark(AI_MARK, true);
    editor.tf.insertText(" And this is streaming in.");
    expect(hasTransientAiState(editor)).toBe(true);
    expect(serialize(editor)).toBe(before);
  });

  it("a structured document's bytes survive a mid-stream autosave", () => {
    const editor = seedEditor(
      "# Heading\n\nSome **bold** prose with a [link](https://example.com).\n\n- one\n- two\n\n> quoted line\n",
    );
    const before = serialize(editor);
    editor.tf.select(editor.api.end([]));
    editor.tf.addMark(AI_MARK, true);
    editor.tf.insertText("streamed remnant");
    expect(serialize(editor)).toBe(before);
  });
});

describe("mid-suggestion autosave", () => {
  it("pending suggestions serialize reject-equivalent (original bytes)", () => {
    const editor = seedEditor(ORIGINAL);
    const before = serialize(editor);
    const applied = applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    expect(applied).toBe(true);
    expect(hasTransientAiState(editor)).toBe(true);
    expect(transientSuggestionIds(editor).length).toBeGreaterThan(0);
    // Insertions ("dog", "was", the new paragraph) stay out of the bytes;
    // deletions ("cat", "is") stay IN — they're the user's original text.
    expect(serialize(editor)).toBe(before);
  });

  it("accept-all serializes the rewrite with zero remnants", () => {
    const editor = seedEditor(ORIGINAL);
    applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    resolveAllSuggestions(editor, "accept");
    expect(hasTransientAiState(editor)).toBe(false);
    const out = serialize(editor);
    expect(out).toContain("The dog was black.");
    expect(out).toContain("A whole new paragraph.");
    expect(out).not.toContain("cat");
    expect(out).not.toContain("suggestion");
  });

  it("reject-all restores the original bytes exactly", () => {
    const editor = seedEditor(ORIGINAL);
    const before = serialize(editor);
    applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    resolveAllSuggestions(editor, "reject");
    expect(hasTransientAiState(editor)).toBe(false);
    expect(serialize(editor)).toBe(before);
  });

  it("a no-change rewrite applies nothing", () => {
    const editor = seedEditor(ORIGINAL);
    expect(applyEditSuggestions(editor, [[0], [1]], parsedValue(ORIGINAL))).toBe(false);
    expect(hasTransientAiState(editor)).toBe(false);
  });

  // A rewrite that DELETES user content: the deletion-marked original text is
  // the user's — it must survive a mid-session autosave byte-for-byte (this is
  // exactly what a blanket disallowedNodes: ["suggestion"] would drop) and
  // must come back whole on reject.
  it("deletion-marked user text survives autosave and reject", () => {
    const editor = seedEditor(ORIGINAL);
    const before = serialize(editor);
    const applied = applyEditSuggestions(
      editor,
      [[0], [1]],
      parsedValue("The cat is black.\n"), // drops "Keep me unchanged."
    );
    expect(applied).toBe(true);
    expect(serialize(editor)).toBe(before); // mid-session bytes keep the paragraph
    resolveAllSuggestions(editor, "reject");
    expect(serialize(editor)).toBe(before);
  });

  // The accept-half-then-switch-files attack: with SOME suggestions resolved,
  // the save gate must keep holding (a flush/unmount mid-session writes the
  // frozen pre-session buffer, never a half-resolved hybrid) until the LAST
  // one resolves — only then does the settled document serialize.
  it("accepting one of several suggestions keeps the save gate held", () => {
    const editor = seedEditor(ORIGINAL);
    applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    const ids = transientSuggestionIds(editor);
    expect(ids.length).toBeGreaterThan(1);
    for (const [index, id] of ids.entries()) {
      expect(hasTransientAiState(editor)).toBe(true);
      resolveSuggestion(editor, id, index % 2 === 0 ? "accept" : "reject");
    }
    expect(hasTransientAiState(editor)).toBe(false);
    const out = serialize(editor);
    expect(out).not.toContain("suggestion");
  });
});

describe("undo during suggestions", () => {
  it("one undo reverts the whole application", () => {
    const editor = seedEditor(ORIGINAL);
    const before = serialize(editor);
    applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    editor.undo();
    expect(hasTransientAiState(editor)).toBe(false);
    expect(serialize(editor)).toBe(before);
  });
});
