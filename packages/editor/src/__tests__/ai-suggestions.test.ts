// Suggestion accept/reject correctness on multi-block edits: per-change
// resolution touches ONLY that change, in any order, and the mixed outcomes
// compose (accept one + reject the rest, etc.).

import { describe, expect, it } from "vitest";
import { createSlateEditor, type Value } from "platejs";
import { serializeMd } from "@platejs/markdown";

import {
  applyEditSuggestions,
  hasTransientSuggestions,
  resolveAllSuggestions,
  resolveSuggestion,
  transientSuggestionIds,
} from "@repo/editor/ai/suggestions";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/editor/markdown/markdown-doc";

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

// Two independent changes in two different blocks, plus an appended block.
const ORIGINAL = "Alpha likes red apples.\n\nBeta likes green pears.\n";
const REWRITE = "Alpha likes crimson apples.\n\nBeta likes emerald pears.\n\nGamma joined late.\n";

function applied() {
  const editor = seedEditor(ORIGINAL);
  const ok = applyEditSuggestions(editor, [[0], [1]], parsedValue(REWRITE));
  expect(ok).toBe(true);
  return editor;
}

describe("multi-block suggestion sessions", () => {
  it("produces one id per independent change", () => {
    const editor = applied();
    // red→crimson, green→emerald, +Gamma block: three separate changes.
    expect(transientSuggestionIds(editor).length).toBeGreaterThanOrEqual(3);
  });

  it("accept-one applies only that change", () => {
    const editor = applied();
    const ids = transientSuggestionIds(editor);
    const first = ids[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    resolveSuggestion(editor, first, "accept");
    // First change (red→crimson) applied; the others still pending, so the
    // serialized bytes show crimson but remain reject-equivalent elsewhere.
    const out = serialize(editor);
    expect(out).toContain("crimson");
    expect(out).not.toContain("red");
    expect(out).toContain("green");
    expect(out).not.toContain("emerald");
    expect(out).not.toContain("Gamma");
    expect(transientSuggestionIds(editor)).toEqual(ids.slice(1));
  });

  it("reject-one reverts only that change", () => {
    const editor = applied();
    const ids = transientSuggestionIds(editor);
    const first = ids[0];
    if (first === undefined) return;
    resolveSuggestion(editor, first, "reject");
    const out = serialize(editor);
    expect(out).toContain("red");
    expect(out).not.toContain("crimson");
    // Remaining changes still pending.
    expect(transientSuggestionIds(editor)).toEqual(ids.slice(1));
    // Accept the rest: green→emerald + the Gamma block land.
    resolveAllSuggestions(editor, "accept");
    const settled = serialize(editor);
    expect(settled).toContain("red");
    expect(settled).toContain("emerald");
    expect(settled).toContain("Gamma joined late.");
    expect(hasTransientSuggestions(editor)).toBe(false);
  });

  it("resolution order does not matter", () => {
    const editor = applied();
    const ids = transientSuggestionIds(editor);
    for (const id of ids.toReversed()) resolveSuggestion(editor, id, "accept");
    const out = serialize(editor);
    expect(out).toContain("crimson");
    expect(out).toContain("emerald");
    expect(out).toContain("Gamma joined late.");
    expect(hasTransientSuggestions(editor)).toBe(false);
  });

  it("resolving an unknown id is a no-op", () => {
    const editor = applied();
    const before = serialize(editor);
    resolveSuggestion(editor, "no-such-id", "accept");
    expect(serialize(editor)).toBe(before);
  });
});
