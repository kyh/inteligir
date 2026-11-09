import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import { cancelComboboxInput, commitComboboxInput } from "@repo/editor/combobox-input";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";
import { insertPageLink } from "@repo/editor/wiki/wiki-insert";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki/wiki-input-key";

const makeEditor = (text: string) =>
  createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text }], type: "p" }],
  });

type Editor = ReturnType<typeof makeEditor>;

const out = (editor: Editor): string => serializeNote(editor);

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
});

const PLAN = "0190a000-0000-7000-8000-000000000001";

describe("picker completion", () => {
  it("links a picked item by its id, with the title it goes by, consuming the literal [", () => {
    const editor = makeEditor("see ");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "Plan" });
    expect(findByType(editor, "mention")).toMatchObject({ key: PLAN, value: "Plan" });
    expect(out(editor)).toBe(`see [Plan](mention:${PLAN})\n`);
  });

  it("leaves a `!` before the `[[` the text it is", () => {
    const editor = makeEditor("see !");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "Plan" });
    expect(out(editor)).toBe(`see \\![Plan](mention:${PLAN})\n`);
  });

  it("keeps typing after completion in the text flow (caret escaped the void)", () => {
    const editor = makeEditor("");
    const element = openWikiPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "note" });
    editor.tf.insertText(" after");
    expect(out(editor)).toBe(`[note](mention:${PLAN}) after\n`);
  });

  it("cancel restores the typed query as plain text", () => {
    const editor = makeEditor("see ");
    const element = openWikiPicker(editor);
    cancelComboboxInput(editor, element, { cause: "escape", restoreText: "[quer" });
    expect(findByType(editor, WIKI_INPUT_KEY)).toBeNull();
    expect(editor.api.string([0])).toBe("see [[quer");
  });
});
