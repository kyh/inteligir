// Teardown of a pending AI suggestion session (#374) — typing the user
// interleaves during a review rides ONLY the live editor value (the save
// buffer is frozen), so abandoning the session must resolve deterministically:
// reject-all reverts ONLY the suggestion-marked ranges — the user's typing
// survives byte-for-byte while the AI proposal disappears. Plus the settle
// registry (transient-settle) the flush path routes through.

import { describe, expect, it } from "vitest";
import { NodeApi, createSlateEditor, type Value } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { applyEditSuggestions, resolveAllSuggestions } from "@repo/app/editor/ai/suggestions";
import { hasTransientAiState } from "@repo/app/editor/ai/transient";
import { registerTransientSettler, settleTransients } from "@repo/app/editor/ai/transient-settle";
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

/** Simulate the user typing at the end of the paragraph containing `marker`
 * — an untouched block, i.e. one the suggestion session didn't mark. */
function typeInto(editor: ReturnType<typeof seedEditor>, marker: string, text: string): void {
  const index = editor.children.findIndex((node) => NodeApi.string(node).includes(marker));
  expect(index).toBeGreaterThanOrEqual(0);
  const end = editor.api.end([index]);
  expect(end).toBeDefined();
  if (end) editor.tf.insertText(text, { at: end });
}

describe("reject-all teardown preserves interleaved typing", () => {
  it("typing in an untouched paragraph survives byte-for-byte", () => {
    const editor = seedEditor(ORIGINAL);
    applyEditSuggestions(editor, [[0]], parsedValue("The dog was black.\n"));
    expect(hasTransientAiState(editor)).toBe(true);
    typeInto(editor, "Keep me unchanged", " Typed mid-review.");
    resolveAllSuggestions(editor, "reject");
    expect(hasTransientAiState(editor)).toBe(false);
    expect(serialize(editor)).toBe("The cat is black.\n\nKeep me unchanged. Typed mid-review.\n");
  });

  it("a multi-block rewrite rejects away whole, typing intact", () => {
    const editor = seedEditor(ORIGINAL);
    applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
    typeInto(editor, "Keep me unchanged", " Still mine.");
    resolveAllSuggestions(editor, "reject");
    const out = serialize(editor);
    expect(out).toContain("The cat is black.");
    expect(out).toContain("Keep me unchanged. Still mine.");
    expect(out).not.toContain("dog");
    expect(out).not.toContain("A whole new paragraph.");
  });
});

describe("transient-settle registry", () => {
  it("routes settle by path and unregisters cleanly", () => {
    const off = registerTransientSettler("a.md", () => "settled-a");
    expect(settleTransients("b.md")).toBeNull();
    expect(settleTransients("a.md")).toBe("settled-a");
    off();
    expect(settleTransients("a.md")).toBeNull();
  });

  it("a stale unregister never clears a newer registration", () => {
    const offA = registerTransientSettler("a.md", () => "A");
    const offB = registerTransientSettler("b.md", () => "B");
    offA(); // a.md's editor unmounted after b.md's mounted — must be a no-op
    expect(settleTransients("b.md")).toBe("B");
    offB();
    expect(settleTransients("b.md")).toBeNull();
  });

  it("holds settlers for every mounted pane at once (#369)", () => {
    // Hidden tabs keep their editors mounted, so N settlers coexist —
    // flushing one tab settles exactly that tab's editor.
    const offA = registerTransientSettler("a.md", () => "A");
    const offB = registerTransientSettler("b.md", () => "B");
    expect(settleTransients("a.md")).toBe("A");
    expect(settleTransients("b.md")).toBe("B");
    offA();
    expect(settleTransients("a.md")).toBeNull();
    expect(settleTransients("b.md")).toBe("B");
    offB();
  });

  it("a remount over the same path replaces the settler", () => {
    const offOld = registerTransientSettler("a.md", () => "old");
    const offNew = registerTransientSettler("a.md", () => "new");
    offOld(); // StrictMode-style stale cleanup — must not clear the newer one
    expect(settleTransients("a.md")).toBe("new");
    offNew();
    expect(settleTransients("a.md")).toBeNull();
  });
});
