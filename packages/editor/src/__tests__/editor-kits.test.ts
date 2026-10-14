import { describe, expect, it } from "vitest";
import { createSlateEditor, ElementApi, KEYS, TextApi } from "platejs";
import type { Descendant, TElement } from "platejs";
import { TogglePlugin } from "@platejs/toggle/react";

import { insertColumnGroup } from "@repo/editor/kits/column-kit";
import { insertDate } from "@repo/editor/kits/date-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { insertEmbedFromUrl } from "@repo/editor/kits/embed-kit";
import { insertEquation, insertInlineEquation } from "@repo/editor/kits/math-kit";
import { insertToggle } from "@repo/editor/kits/toggle-kit";
import { parseMarkdown, roundTrip, serializeNote } from "@repo/editor/markdown/markdown-doc";

const makeEditor = (md = "") => {
  const parsed = md === "" ? null : parseMarkdown(md);
  const value = parsed && parsed.ok ? parsed.value : [{ children: [{ text: "" }], type: "p" }];
  return createSlateEditor({ plugins: EDITOR_KIT, value });
};

const out = (editor: ReturnType<typeof makeEditor>): string => serializeNote(editor);

const el = (node: Descendant | undefined): TElement => {
  if (node === undefined || !ElementApi.isElement(node)) {
    throw new Error("expected an element node");
  }
  return node;
};

describe("column normalizer (suppressed width writer)", () => {
  it("keeps bare columns bare through a forced normalize + edit", () => {
    const src = ":::columns\n:::column\nleft\n:::\n\n:::column\nright\n:::\n:::\n";
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    editor.tf.insertText("+", { at: { offset: 0, path: [0, 0, 0, 0] } });
    const output = out(editor);
    expect(output).toBe(":::columns\n:::column\n+left\n:::\n\n:::column\nright\n:::\n:::\n");
    expect(roundTrip(output)).toBe(output);
  });

  it("keeps three bare columns bare (the 33.333…% hazard)", () => {
    const src = ":::columns\n:::column\na\n:::\n\n:::column\nb\n:::\n\n:::column\nc\n:::\n:::\n";
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    expect(out(editor)).toBe(src);
  });

  it("preserves authored widths without rebalancing to 100", () => {
    // 70 + 40 ≠ 100, which the stock normalizer would rebalance
    const src = ":::columns\n:::column 70%\na\n:::\n\n:::column 40%\nb\n:::\n:::\n";
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    expect(out(editor)).toBe(src);
  });

  it("still dissolves a group left with a single column", () => {
    const editor = makeEditor(":::columns\n:::column\nkeep\n:::\n\n:::column\ndrop\n:::\n:::\n");
    editor.tf.removeNodes({ at: [0, 1] });
    expect(out(editor)).toBe("keep\n");
  });
});

describe("insertColumnGroup", () => {
  it("inserts bare columns whose empty form is their two markers", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 2);
    const output = out(editor);
    expect(output).toBe("seed\n\n:::columns\n:::column\n:::\n\n:::column\n:::\n:::\n");
    expect(roundTrip(output)).toBe(output);
  });

  it("a half-filled group stays canonical (one filled, one still empty)", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 2);
    editor.tf.insertText("left cell");
    const output = out(editor);
    expect(output).toBe("seed\n\n:::columns\n:::column\nleft cell\n:::\n\n:::column\n:::\n:::\n");
    expect(roundTrip(output)).toBe(output);
  });

  it("inserts three bare columns for count 3", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 3);
    expect((out(editor).match(/:::column\n:::/gu) ?? []).length).toBe(3);
  });
});

const type = (editor: ReturnType<typeof makeEditor>, text: string) => {
  for (const char of text) {
    editor.tf.insertText(char);
  }
};

// The trigger fires only on a single typed `[`, so these bulk-insert the body
// (the paste / cancel-restore path the `]]` rule serves) and type the closers.
describe("wiki `]]` completion rule", () => {
  it("completes [[Note]] into a wikiLink chip whose bytes round-trip", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText(" see [[Some Note");
    type(editor, "]]");
    const wiki = el(editor.children[0]).children.find(
      (child) => ElementApi.isElement(child) && child.type === "wikiLink",
    );
    expect(wiki).toMatchObject({ body: "Some Note", type: "wikiLink" });
    const output = out(editor);
    expect(output).toContain("[[Some Note]]");
    expect(roundTrip(output)).toBe(output);
  });

  it("typing [[ char-by-char opens the autocomplete picker instead", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    type(editor, " [[");
    expect(JSON.stringify(editor.children).includes("wiki_input")).toBe(true);
  });

  it("completes ![[img.png]] into a wikiEmbed chip", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText(" ![[img.png");
    type(editor, "]]");
    expect(out(editor)).toContain("![[img.png]]");
    expect(
      el(editor.children[0]).children.some(
        (c) => ElementApi.isElement(c) && c.type === "wikiEmbed",
      ),
    ).toBe(true);
  });

  it("keeps alias/anchor bodies verbatim", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText(" [[target#sec|alias");
    type(editor, "]]");
    expect(out(editor)).toContain("[[target#sec|alias]]");
  });

  it("does not fire inside code blocks", () => {
    const editor = makeEditor("```\ncode\n```\n");
    editor.tf.select(editor.api.end([0, 0]));
    type(editor, " [[not a link]]");
    expect(out(editor)).toContain("[[not a link]]");
    expect(JSON.stringify(el(editor.children[0])).includes("wikiLink")).toBe(false);
  });

  it("leaves a lone ] alone", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    type(editor, " [TODO]");
    expect(editor.api.string([0])).toBe("x [TODO]");
  });

  it("never leaks zero-width spaces around live-typed inline voids", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    editor.tf.insertText(" [[a");
    type(editor, "]]");
    editor.tf.insertText("![[b");
    type(editor, "]]");
    type(editor, " tail");
    const output = out(editor);
    expect(output).toBe("x [[a]]![[b]] tail\n");
    expect(output).not.toContain("​");
    expect(roundTrip(output)).toBe(output);
  });

  it("still preserves a deliberately empty paragraph (ZWSP placeholder)", () => {
    const editor = makeEditor("a\n\nb\n");
    editor.tf.insertNodes({ children: [{ text: "" }], type: "p" }, { at: [1] });
    const output = out(editor);
    expect(output).toContain("​");
    expect(roundTrip(output)).toBe(output);
  });
});

describe("insertToggle", () => {
  it("wraps the current block as the toggle summary (nested model)", () => {
    const editor = makeEditor("Summary line\n");
    editor.tf.select(editor.api.end([0]));
    insertToggle(editor);
    const output = out(editor);
    expect(output).toBe(":::toggle\nSummary line\n:::\n");
    expect(roundTrip(output)).toBe(output);
  });

  it("Enter on the summary splits INSIDE the toggle (body block)", () => {
    const editor = makeEditor("Summary\n");
    editor.tf.select(editor.api.end([0]));
    insertToggle(editor);
    editor.tf.insertBreak();
    editor.tf.insertText("body");
    expect(out(editor)).toBe(":::toggle\nSummary\n\nbody\n:::\n");
  });

  it("normalizes typed-into empty toggle children into a paragraph", () => {
    const editor = makeEditor(":::toggle\n:::\n");
    editor.tf.select(editor.api.start([0]));
    editor.tf.insertText("hello");
    const output = out(editor);
    expect(output).toBe(":::toggle\nhello\n:::\n");
  });

  it("leaves an untouched empty toggle byte-exact", () => {
    const editor = makeEditor(":::toggle\n:::\n\ntext\n");
    editor.tf.insertText("!", { at: { offset: 4, path: [1, 0] } });
    expect(out(editor)).toBe(":::toggle\n:::\n\ntext!\n");
  });

  it("collapse state lives in the plugin store — flipping it never dirties bytes", () => {
    // headless parse assigns no NodeIdPlugin ids, so an explicit id is driven
    const editor = makeEditor(":::toggle\nSummary\n\nbody\n:::\n");
    const before = out(editor);
    const isOpen = (id: string) => editor.getOptions(TogglePlugin).openIds?.has(id) ?? false;
    expect(isOpen("t1")).toBe(false);
    editor.getApi(TogglePlugin).toggle.toggleIds(["t1"]);
    expect(isOpen("t1")).toBe(true);
    editor.getApi(TogglePlugin).toggle.toggleIds(["t1"]);
    expect(isOpen("t1")).toBe(false);
    expect(out(editor)).toBe(before);
    expect(before).toBe(":::toggle\nSummary\n\nbody\n:::\n");
  });
});

describe("insert transforms serialize canonically", () => {
  it("insertDate writes ISO bytes", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    insertDate(editor);
    const output = out(editor);
    expect(output).toMatch(/^x@\d{4}-\d{2}-\d{2}/u);
    expect(roundTrip(output)).toBe(output);
  });

  it("insertEquation / insertInlineEquation create texExpression nodes", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    insertEquation(editor);
    const equation = editor.children.find(
      (n) => ElementApi.isElement(n) && n.type === KEYS.equation,
    );
    expect(equation).toMatchObject({ texExpression: "" });

    const inlineHost = makeEditor("x\n");
    inlineHost.tf.select(inlineHost.api.end([0]));
    insertInlineEquation(inlineHost);
    expect(
      el(inlineHost.children[0]).children.some(
        (c) => ElementApi.isElement(c) && c.type === KEYS.inlineEquation,
      ),
    ).toBe(true);
  });

  it("an empty inline equation writes nothing, and the text either side stays one run", () => {
    const editor = makeEditor("**ab**\n");
    editor.tf.select({ offset: 1, path: [0, 0] });
    insertInlineEquation(editor);
    expect(
      el(editor.children[0]).children.some(
        (c) => ElementApi.isElement(c) && c.type === KEYS.inlineEquation,
      ),
    ).toBe(true);
    expect(out(editor)).toBe("**ab**\n");
  });

  it.each([
    ["a heading", "# **ab**\n"],
    ["a list item", "- **ab**\n"],
    ["a todo", "- [ ] **ab**\n"],
  ])("an empty inline equation in %s leaves one run either side", (_where, md) => {
    const editor = makeEditor(md);
    const [text] = editor.api.nodes({ at: [0], match: (node) => TextApi.isText(node) });
    if (text === undefined) {
      throw new Error("the block holds no text");
    }
    editor.tf.select({ offset: 1, path: text[1] });
    insertInlineEquation(editor);
    expect(
      [...editor.api.nodes({ at: [0], match: (node) => ElementApi.isElement(node) })].some(
        ([node]) => node.type === KEYS.inlineEquation,
      ),
    ).toBe(true);
    expect(out(editor)).toBe(md);
  });

  it("equation edits serialize to $$ blocks that round-trip", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    insertEquation(editor);
    const at = editor.children.findIndex(
      (n) => ElementApi.isElement(n) && n.type === KEYS.equation,
    );
    editor.tf.setNodes({ texExpression: "E = mc^2" }, { at: [at] });
    const output = out(editor);
    expect(output).toContain("$$\nE = mc^2\n$$");
    expect(roundTrip(output)).toBe(output);
  });

  it("insertEmbedFromUrl routes youtube/tweet/pdf/generic to the nodes the url reads back as", () => {
    const cases: [string, string][] = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", KEYS.video],
      ["https://twitter.com/user/status/1234567890", KEYS.mediaEmbed],
      ["https://example.com/paper.pdf", KEYS.file],
      ["https://example.com/embed", KEYS.mediaEmbed],
    ];
    for (const [url, embedType] of cases) {
      const editor = makeEditor("x\n");
      editor.tf.select(editor.api.end([0]));
      insertEmbedFromUrl(editor, url);
      expect(
        editor.children.some((node) => ElementApi.isElement(node) && node.type === embedType),
        url,
      ).toBe(true);
      const output = out(editor);
      expect(output, url).toContain(`![](${url})`);
      expect(roundTrip(output), url).toBe(output);
      const reread = parseMarkdown(output);
      expect(reread.ok && reread.value.some((node) => node.type === embedType), url).toBe(true);
    }
  });

  it("insertEmbedFromUrl refuses a url off the web, which would read back as an image", () => {
    for (const url of ["assets/report.pdf", "example.com", "www.youtube.com/watch?v=dQw4w9WgXcQ"]) {
      const editor = makeEditor("x\n");
      editor.tf.select(editor.api.end([0]));
      expect(insertEmbedFromUrl(editor, url), url).toBe(false);
      expect(out(editor), url).toBe("x\n");
    }
  });
});
