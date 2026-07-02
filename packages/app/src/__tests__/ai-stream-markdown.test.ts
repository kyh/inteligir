// Streaming markdown insert (#370) — generate-intent deltas land as PARSED
// blocks (headings/lists/bold/fences), not literal text in one paragraph.
// Contracts: chunked and one-shot streams converge; mid-stream bytes stay
// frozen (transient gate + serializer defense); discard (undo unwind)
// removes everything inserted; accept (mark strip) keeps the parsed blocks
// and the saved bytes are canonical.

import { describe, expect, it } from "vitest";
import { NodeApi, TextApi, createSlateEditor, type Descendant, type Value } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { createMarkdownStream, stripAiMarks } from "@repo/app/editor/ai/stream-markdown";
import { hasTransientAiState } from "@repo/app/editor/ai/transient";
import { EDITOR_KIT } from "@repo/app/editor/kits/editor-kit";
import {
  MD_STRINGIFY,
  analyzeMarkdown,
  parseMarkdown,
} from "@repo/app/editor/markdown/markdown-doc";

function seedEditor(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}

function emptyEditor() {
  const value: Value = [{ children: [{ text: "" }], type: "p" }];
  return createSlateEditor({ plugins: EDITOR_KIT, value });
}

function serialize(editor: ReturnType<typeof seedEditor>): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

// The dev harness's streaming shape: word-boundary splits, three per chunk
// (fixture-bridge's streamText), so chunk edges land mid-construct.
function chunkify(text: string): string[] {
  const words = text.split(/(?<= )/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(""));
  return chunks;
}

// Mirrors the fixture bridge's canned generate reply: one of each construct.
const GENERATED = [
  "## Canned heading",
  "",
  "The dev-harness generator streams **markdown** now, and each construct lands as a real block.",
  "",
  "- first canned bullet",
  "- second canned bullet with _emphasis_",
  "",
  "```ts",
  "const canned = true;",
  "```",
  "",
  "A closing paragraph follows the fence.",
].join("\n");

const SEED = "Start here.\n";

function someText(nodes: Descendant[], pred: (t: Record<string, unknown>) => boolean): boolean {
  return nodes.some((node) => {
    if (TextApi.isText(node)) return pred(node);
    return "children" in node && someText(node.children, pred);
  });
}

describe("streaming markdown insert", () => {
  it("a multi-block markdown stream lands as parsed blocks", () => {
    const editor = seedEditor(SEED);
    const stream = createMarkdownStream(editor, 0);
    for (const chunk of chunkify(GENERATED)) stream.append(chunk);

    // The seed paragraph is untouched; the generation follows as blocks.
    const first = editor.children[0];
    expect(first && NodeApi.string(first)).toBe("Start here.");
    const types = editor.children.map((node) => node.type);
    expect(types).toContain("h2");
    expect(types).toContain("code_block");
    expect(editor.children.some((node) => node["listStyleType"] === "disc")).toBe(true);
    expect(someText(editor.children, (t) => t["bold"] === true)).toBe(true);
    // Every inserted node carries the transient mark — the byte-safety gate.
    expect(hasTransientAiState(editor)).toBe(true);
  });

  it("chunked and one-shot streams converge to the same document", () => {
    const chunked = seedEditor(SEED);
    const chunkedStream = createMarkdownStream(chunked, 0);
    for (const chunk of chunkify(GENERATED)) chunkedStream.append(chunk);

    const oneShot = seedEditor(SEED);
    createMarkdownStream(oneShot, 0).append(GENERATED);

    expect(chunked.children).toEqual(oneShot.children);
  });

  it("a mid-stream autosave writes the pre-stream bytes", () => {
    const editor = seedEditor(SEED);
    const before = serialize(editor);
    const stream = createMarkdownStream(editor, 0);
    for (const chunk of chunkify(GENERATED).slice(0, 5)) stream.append(chunk);
    expect(hasTransientAiState(editor)).toBe(true);
    expect(serialize(editor)).toBe(before);
  });

  it("discard unwinds every inserted block", () => {
    const editor = seedEditor(SEED);
    const before = serialize(editor);
    const undoDepth = editor.history.undos.length;
    const stream = createMarkdownStream(editor, 0);
    for (const chunk of chunkify(GENERATED)) stream.append(chunk);
    while (editor.history.undos.length > undoDepth) editor.undo();
    expect(hasTransientAiState(editor)).toBe(false);
    expect(serialize(editor)).toBe(before);
  });

  it("accept strips the marks and the saved bytes are canonical", () => {
    const editor = seedEditor(SEED);
    const stream = createMarkdownStream(editor, 0);
    for (const chunk of chunkify(GENERATED)) stream.append(chunk);
    stripAiMarks(editor);
    expect(hasTransientAiState(editor)).toBe(false);
    const out = serialize(editor);
    expect(out).toContain("## Canned heading");
    expect(out).toContain("- first canned bullet");
    expect(out).toContain("const canned = true;");
    expect(analyzeMarkdown(out).canonical).toBe(true);
  });

  it("an empty seed paragraph is replaced, and restored on discard", () => {
    const editor = emptyEditor();
    const undoDepth = editor.history.undos.length;
    const stream = createMarkdownStream(editor, 0);
    stream.append("## Title\n\nBody text.");
    const first = editor.children[0];
    expect(first?.type).toBe("h2");
    while (editor.history.undos.length > undoDepth) editor.undo();
    expect(editor.children.length).toBe(1);
    const restored = editor.children[0];
    expect(restored && NodeApi.string(restored)).toBe("");
  });

  it("unparseable stream text degrades to visible plain paragraphs", () => {
    const editor = seedEditor(SEED);
    const stream = createMarkdownStream(editor, 0);
    stream.append("<div>legacy html tail");
    expect(NodeApi.string(editor)).toContain("<div>legacy html tail");
    expect(hasTransientAiState(editor)).toBe(true);
  });
});
