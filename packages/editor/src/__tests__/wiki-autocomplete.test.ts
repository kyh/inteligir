import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { TElement } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { cancelComboboxInput, commitComboboxInput } from "@repo/editor/combobox-input";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY } from "@repo/editor/markdown/markdown-doc";
import { insertWikiChipFromPicker } from "@repo/editor/wiki-insert";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";

const makeEditor = (text: string) =>
  createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text }], type: "p" }],
  });

type Editor = ReturnType<typeof makeEditor>;

const out = (editor: Editor): string =>
  serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });

const findByType = (editor: Editor, type: string): TElement | null => {
  for (const [node] of editor.api.nodes({ at: [], match: { type } })) {
    if (ElementApi.isElement(node)) {
      return node;
    }
  }
  return null;
};

const openWikiPicker = (editor: Editor): TElement => {
  const end = editor.api.end([0]);
  if (!end) {
    throw new Error("no end point");
  }
  editor.tf.select(end);
  editor.tf.insertText("[");
  editor.tf.insertText("[");
  const element = findByType(editor, WIKI_INPUT_KEY);
  if (!element) {
    throw new Error("[[ did not insert the wiki input element");
  }
  return element;
};

describe("[[ trigger", () => {
  it("a single [ stays plain text — no picker", () => {
    const editor = makeEditor("see ");
    const end = editor.api.end([0]);
    if (end) {
      editor.tf.select(end);
    }
    editor.tf.insertText("[");
    expect(findByType(editor, WIKI_INPUT_KEY)).toBeNull();
    expect(out(editor)).toBe("see \\[\n");
  });

  it("[[ inserts the trigger element after the literal first [", () => {
    const editor = makeEditor("see ");
    openWikiPicker(editor);
    expect(editor.api.string([0])).toContain("see [");
  });

  it("a mid-picker autosave serializes without the trigger element", () => {
    const editor = makeEditor("see ");
    openWikiPicker(editor);
    expect(out(editor)).toBe("see \\[\n");
  });
});

describe("picker completion", () => {
  it("completes a wikiLink chip, consuming the literal [", () => {
    const editor = makeEditor("see ");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertWikiChipFromPicker(editor, "target note");
    expect(findByType(editor, "wikiLink")?.body).toBe("target note");
    expect(out(editor)).toBe("see [[target note]]\n");
  });

  it("upgrades ![[ to a wikiEmbed chip, consuming the bang", () => {
    const editor = makeEditor("see !");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertWikiChipFromPicker(editor, "target note");
    expect(findByType(editor, "wikiEmbed")?.body).toBe("target note");
    expect(findByType(editor, "wikiLink")).toBeNull();
    expect(out(editor)).toBe("see ![[target note]]\n");
  });

  it("an attachment pick forces a wikiEmbed even from a plain [[", () => {
    const editor = makeEditor("see ");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertWikiChipFromPicker(editor, "diagram.png", true);
    expect(findByType(editor, "wikiEmbed")?.body).toBe("diagram.png");
    expect(findByType(editor, "wikiLink")).toBeNull();
    expect(out(editor)).toBe("see ![[diagram.png]]\n");
  });

  it("a forced embed after ![[ still consumes the bang (no double bang)", () => {
    const editor = makeEditor("see !");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertWikiChipFromPicker(editor, "diagram.png", true);
    expect(out(editor)).toBe("see ![[diagram.png]]\n");
  });

  it("keeps typing after completion in the text flow (caret escaped the void)", () => {
    const editor = makeEditor("");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertWikiChipFromPicker(editor, "note");
    editor.tf.insertText(" after");
    expect(out(editor)).toBe("[[note]] after\n");
  });

  it("cancel restores the typed query as plain text", () => {
    const editor = makeEditor("see ");
    const element = openWikiPicker(editor);
    cancelComboboxInput(editor, element, { cause: "escape", restoreText: "[quer" });
    expect(findByType(editor, WIKI_INPUT_KEY)).toBeNull();
    expect(editor.api.string([0])).toBe("see [[quer");
  });
});
