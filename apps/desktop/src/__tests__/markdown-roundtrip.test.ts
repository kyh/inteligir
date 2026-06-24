import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseUnderlinePlugin,
} from "@platejs/basic-nodes";
import { BaseCodeBlockPlugin, BaseCodeLinePlugin } from "@platejs/code-block";
import { BaseLinkPlugin } from "@platejs/link";
import { BaseListPlugin } from "@platejs/list";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@platejs/markdown";

// Headless mirror of the editor's plugin set (the Base* node plugins carry the
// markdown rules; the /react variants just add rendering). This is the real
// fidelity guard: the editor round-trips the user's markdown, and a serializer
// that silently drops a construct would corrupt vault files.
function makeEditor() {
  return createSlateEditor({
    plugins: [
      BaseBoldPlugin,
      BaseItalicPlugin,
      BaseUnderlinePlugin,
      BaseStrikethroughPlugin,
      BaseCodePlugin,
      BaseH1Plugin,
      BaseH2Plugin,
      BaseH3Plugin,
      BaseBlockquotePlugin,
      BaseCodeBlockPlugin,
      BaseCodeLinePlugin,
      BaseListPlugin,
      BaseLinkPlugin,
      MarkdownPlugin,
    ],
  });
}

function roundTrip(md: string): string {
  const editor = makeEditor();
  return serializeMd(editor, { value: deserializeMd(editor, md) });
}

describe("markdown round-trip", () => {
  it("preserves the common constructs the editor supports", () => {
    const md = [
      "# Title",
      "",
      "Some **bold**, *italic*, and `inline code`.",
      "",
      "## Section",
      "",
      "- first",
      "- second",
      "",
      "> a quote",
      "",
      "[a link](https://example.com)",
      "",
      "```",
      "code block",
      "```",
      "",
    ].join("\n");

    const out = roundTrip(md);
    expect(out).toContain("# Title");
    expect(out).toContain("## Section");
    expect(out).toContain("**bold**");
    expect(out).toContain("`inline code`");
    // The serializer may emit `-` or `*` bullets; assert marker-agnostically.
    expect(out).toMatch(/[-*] first/);
    expect(out).toMatch(/[-*] second/);
    expect(out).toContain("> a quote");
    expect(out).toContain("[a link](https://example.com)");
    expect(out).toContain("code block");
  });

  it("is idempotent after the first normalization pass", () => {
    const md = "# Hi\n\nHello **world** with a list:\n\n- one\n- two\n";
    const first = roundTrip(md);
    // Re-running the round-trip on already-normalized markdown must be stable —
    // otherwise repeated rich-edit saves would keep churning the file.
    const second = roundTrip(first);
    expect(second).toBe(first);
  });

  it("does not invent content for an empty document", () => {
    expect(roundTrip("").trim()).toBe("");
  });
});
