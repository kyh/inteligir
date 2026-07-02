// WP2 kit behaviors, exercised on a headless editor built from the LIVE
// EDITOR_KIT (the React halves' overrides — column normalizer, wiki `]]`
// rule, toggle child normalizer — are editor behavior, not render behavior).
// Serialization itself is pinned by the WP1 fixture matrix; these tests pin
// the editing transforms that feed it.

import { describe, expect, it } from "vitest";
import { createSlateEditor, ElementApi, KEYS, type TElement } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { insertColumnGroup } from "@repo/app/editor/kits/column-kit";
import { insertDate } from "@repo/app/editor/kits/date-kit";
import { EDITOR_KIT } from "@repo/app/editor/kits/editor-kit";
import { insertEmbedFromUrl } from "@repo/app/editor/kits/embed-kit";
import { insertEquation, insertInlineEquation } from "@repo/app/editor/kits/math-kit";
import { insertToggle } from "@repo/app/editor/kits/toggle-kit";
import { MD_STRINGIFY, parseMarkdown, roundTrip } from "@repo/app/editor/markdown/markdown-doc";

// The live-editor plugin type is irrelevant to these behaviors; the loose
// editor from createSlateEditor(EDITOR_KIT) matches the transforms' PlateEditor
// parameter structurally.
function makeEditor(md = "") {
  const parsed = md === "" ? null : parseMarkdown(md);
  const value = parsed && parsed.ok ? parsed.value : [{ children: [{ text: "" }], type: "p" }];
  return createSlateEditor({ plugins: EDITOR_KIT, value });
}

function out(editor: ReturnType<typeof makeEditor>): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

// Assertion-free element narrowing (repo bans `as`).
function el(node: unknown): TElement {
  if (node === null || typeof node !== "object" || !ElementApi.isElement(node)) {
    throw new Error("expected an element node");
  }
  return node;
}

describe("column normalizer (suppressed width writer)", () => {
  it("keeps bare columns bare through a forced normalize + edit", () => {
    const src =
      "<column_group>\n  <column>\n    left\n  </column>\n\n  <column>\n    right\n  </column>\n</column_group>\n";
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    // Edit inside the first column — @platejs/layout's withColumn would stamp
    // width="50%" (or 33.333333333333336% for 3 cols) into the group here.
    editor.tf.insertText("+", { at: { offset: 0, path: [0, 0, 0, 0] } });
    const output = out(editor);
    expect(output).toContain("<column>");
    expect(output).not.toContain("width");
    expect(roundTrip(output)).toBe(output);
  });

  it("keeps three bare columns bare (the 33.333…% hazard)", () => {
    const src =
      "<column_group>\n  <column>\n    a\n  </column>\n\n  <column>\n    b\n  </column>\n\n  <column>\n    c\n  </column>\n</column_group>\n";
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    expect(out(editor)).not.toContain("width");
  });

  it("preserves authored widths without rebalancing to 100", () => {
    // 70 + 40 ≠ 100 — the stock normalizer would rewrite both columns.
    const src =
      '<column_group>\n  <column width="70%">\n    a\n  </column>\n\n  <column width="40%">\n    b\n  </column>\n</column_group>\n';
    const editor = makeEditor(src);
    editor.tf.normalize({ force: true });
    const output = out(editor);
    expect(output).toContain('width="70%"');
    expect(output).toContain('width="40%"');
  });

  it("still dissolves a group left with a single column", () => {
    const editor = makeEditor(
      "<column_group>\n  <column>\n    keep\n  </column>\n\n  <column>\n    drop\n  </column>\n</column_group>\n",
    );
    editor.tf.removeNodes({ at: [0, 1] });
    const output = out(editor);
    expect(output).not.toContain("column_group");
    expect(output).toContain("keep");
  });
});

describe("insertColumnGroup", () => {
  it("inserts bare columns whose EMPTY form is the self-closed canonical one", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 2);
    // An autosave can land before either column has content: the empty
    // column (one empty paragraph) must serialize to `<column />` — the
    // same bytes its parse produces — or the very first save is
    // non-canonical and the file falls to Raw (live-drive regression).
    const output = out(editor);
    expect(output).toContain("<column_group>");
    expect((output.match(/<column \/>/g) ?? []).length).toBe(2);
    expect(output).not.toContain("width");
    expect(roundTrip(output)).toBe(output);
  });

  it("a half-filled group stays canonical (one filled, one still empty)", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 2);
    editor.tf.insertText("left cell");
    const output = out(editor);
    expect(output).toContain("left cell");
    expect(output).toContain("<column />");
    expect(roundTrip(output)).toBe(output);
  });

  it("inserts three bare columns for count 3", () => {
    const editor = makeEditor("seed\n");
    editor.tf.select(editor.api.end([0]));
    insertColumnGroup(editor, 3);
    expect((out(editor).match(/<column \/>/g) ?? []).length).toBe(3);
  });
});

function type(editor: ReturnType<typeof makeEditor>, text: string) {
  for (const char of text) editor.tf.insertText(char);
}

describe("wiki `]]` completion rule", () => {
  it("completes [[Note]] into a wikiLink chip whose bytes round-trip", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    type(editor, " see [[Some Note]]");
    const wiki = el(editor.children[0]).children.find(
      (child) => ElementApi.isElement(child) && child.type === "wikiLink",
    );
    expect(wiki).toMatchObject({ body: "Some Note", type: "wikiLink" });
    const output = out(editor);
    expect(output).toContain("[[Some Note]]");
    expect(roundTrip(output)).toBe(output);
  });

  it("completes ![[img.png]] into a wikiEmbed chip", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    type(editor, " ![[img.png]]");
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
    type(editor, " [[target#sec|alias]]");
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
    // Slate normalization pads inline elements with empty text siblings;
    // Plate's default p rule would serialize each as U+200B (the md-rules
    // p override prunes them — this is its regression pin). Typing must also
    // CONTINUE after a completed chip — a caret parked inside the void would
    // swallow the rest of the line.
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    type(editor, " [[a]]![[b]] tail");
    const output = out(editor);
    expect(output).toBe("x [[a]]![[b]] tail\n");
    expect(output).not.toContain("​");
    expect(roundTrip(output)).toBe(output);
  });

  it("still preserves a deliberately empty paragraph (ZWSP placeholder)", () => {
    const editor = makeEditor("a\n\nb\n");
    // Turn the doc into a / EMPTY / b by inserting an empty paragraph.
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
    expect(output).toBe("<toggle>\n  Summary line\n</toggle>\n");
    expect(roundTrip(output)).toBe(output);
  });

  it("Enter on the summary splits INSIDE the toggle (body block)", () => {
    const editor = makeEditor("Summary\n");
    editor.tf.select(editor.api.end([0]));
    insertToggle(editor);
    editor.tf.insertBreak();
    editor.tf.insertText("body");
    expect(out(editor)).toBe("<toggle>\n  Summary\n\n  body\n</toggle>\n");
  });

  it("normalizes typed-into empty <toggle /> children into a paragraph", () => {
    const editor = makeEditor("<toggle />\n");
    editor.tf.select(editor.api.start([0]));
    editor.tf.insertText("hello");
    const output = out(editor);
    expect(output).toBe("<toggle>\n  hello\n</toggle>\n");
  });

  it("leaves an untouched <toggle /> byte-exact", () => {
    const editor = makeEditor("<toggle />\n\ntext\n");
    editor.tf.insertText("!", { at: { offset: 4, path: [1, 0] } });
    expect(out(editor)).toBe("<toggle />\n\ntext!\n");
  });
});

describe("insert transforms serialize canonically", () => {
  it("insertDate writes ISO bytes", () => {
    const editor = makeEditor("x\n");
    editor.tf.select(editor.api.end([0]));
    insertDate(editor);
    const output = out(editor);
    expect(output).toMatch(/<date value="\d{4}-\d{2}-\d{2}" \/>/);
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

  it("insertEmbedFromUrl routes youtube/tweet/pdf/generic to the right nodes", () => {
    const cases: Array<[string, string]> = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "<video src="],
      ["https://twitter.com/user/status/1234567890", "<media_embed src="],
      ["https://example.com/paper.pdf", "<file src="],
      ["https://example.com/embed", "<media_embed src="],
    ];
    for (const [url, tag] of cases) {
      const editor = makeEditor("x\n");
      editor.tf.select(editor.api.end([0]));
      insertEmbedFromUrl(editor, url);
      const output = out(editor);
      expect(output, url).toContain(tag);
      expect(output, `${url} must stay bare src-only`).not.toMatch(/align|width|isUpload/);
      expect(roundTrip(output), url).toBe(output);
    }
  });
});
