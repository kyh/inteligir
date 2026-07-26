// The AI session's privacy/provider gate lives at the two request funnels
// (startGenerate/startEdit), not stamped on every entry point. This pins the
// funnel through an entry point that carries no gate of its own: runTranslate
// on a `private: true` doc must issue no generateInlineAi call and settle the
// session back on the prompt.

import { describe, expect, it, vi } from "vitest";
import { createPlateEditor } from "platejs/react";

import { AiSessionPlugin, runTranslate } from "@renderer/editor/ai/ai-session";
import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { parseMarkdown } from "@renderer/editor/markdown/markdown-doc";

const helpers = vi.hoisted(() => ({
  bridgeMock: {
    // Never settles: the control test only asserts the call was issued — a
    // resolution would race suggestion-apply mutations past the test's end.
    generateInlineAi: vi.fn(() => new Promise<never>(() => {})),
    classifyAiIntent: vi.fn(() => Promise.resolve({ intent: "edit" })),
    onAiStreamed: vi.fn(() => () => {}),
  },
}));

vi.mock("@renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

function seedEditor(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createPlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}

describe("AI request funnel privacy gate (#451)", () => {
  it("a private note blocks at the funnel: runTranslate issues no request", () => {
    const editor = seedEditor("---\nprivate: true\n---\n\nSecret body.\n");
    editor.tf.select([1]);
    runTranslate(editor, "French");
    expect(helpers.bridgeMock.generateInlineAi).not.toHaveBeenCalled();
    expect(helpers.bridgeMock.classifyAiIntent).not.toHaveBeenCalled();
    expect(editor.getOption(AiSessionPlugin, "status")).toBe("input");
  });

  it("a public note passes the funnel (the guard is not vacuously closed)", () => {
    const editor = seedEditor("Public body.\n");
    editor.tf.select([0]);
    runTranslate(editor, "French");
    expect(helpers.bridgeMock.generateInlineAi).toHaveBeenCalledTimes(1);
    expect(editor.getOption(AiSessionPlugin, "status")).toBe("editing");
  });
});
