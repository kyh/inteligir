import { describe, expect, it } from "vitest";
import { ElementApi, KEYS, createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import { cancelComboboxInput, commitComboboxInput } from "@repo/editor/combobox-input";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";
import { createAndLink, insertPageLink } from "@repo/editor/mention/mention-insert";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

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

const typeAtEnd = (editor: Editor, ...chars: string[]): void => {
  const end = editor.api.end([0]);
  if (!end) {
    throw new Error("no end point");
  }
  editor.tf.select(end);
  for (const char of chars) {
    editor.tf.insertText(char);
  }
};

const openPicker = (editor: Editor): TElement => {
  typeAtEnd(editor, "[", "[");
  const element = findByType(editor, KEYS.mentionInput);
  if (!element) {
    throw new Error("[[ did not open Plate's mention input");
  }
  return element;
};

describe("[[ opens Plate's mention input", () => {
  it("on the second [, the first staying the text typed", () => {
    const editor = makeEditor("see ");
    expect(openPicker(editor)).toMatchObject({ trigger: "[", type: KEYS.mentionInput });
    expect(editor.api.string([0])).toBe("see [");
  });

  it("not on a single [, which stays plain text", () => {
    const editor = makeEditor("see ");
    typeAtEnd(editor, "[");
    expect(findByType(editor, KEYS.mentionInput)).toBeNull();
    expect(out(editor)).toBe("see \\[\n");
  });

  it("not on an @, which stays the character typed", () => {
    const editor = makeEditor("see ");
    typeAtEnd(editor, "@");
    expect(findByType(editor, KEYS.mentionInput)).toBeNull();
    expect(editor.api.string([0])).toBe("see @");
  });
});

const PLAN = "0190a000-0000-7000-8000-000000000001";

describe("picker completion", () => {
  it("links a picked item by its id, with the title it goes by, consuming the literal [", () => {
    const editor = makeEditor("see ");
    const element = openPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "Plan" });
    expect(findByType(editor, KEYS.mention)).toMatchObject({ key: PLAN, value: "Plan" });
    expect(out(editor)).toBe(`see [Plan](mention:${PLAN})\n`);
  });

  it("leaves a `!` before the `[[` the text it is", () => {
    const editor = makeEditor("see !");
    const element = openPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "Plan" });
    expect(out(editor)).toBe(`see \\![Plan](mention:${PLAN})\n`);
  });

  it("keeps typing after completion in the text flow (caret escaped the void)", () => {
    const editor = makeEditor("");
    const element = openPicker(editor);
    commitComboboxInput(editor, element, false);
    insertPageLink(editor, { id: PLAN, title: "note" });
    editor.tf.insertText(" after");
    expect(out(editor)).toBe(`[note](mention:${PLAN}) after\n`);
  });

  it("cancel restores the typed query as plain text", () => {
    const editor = makeEditor("see ");
    const element = openPicker(editor);
    cancelComboboxInput(editor, element, { cause: "escape", restoreText: "[quer" });
    expect(findByType(editor, KEYS.mentionInput)).toBeNull();
    expect(editor.api.string([0])).toBe("see [[quer");
  });
});

describe("a link's Create", () => {
  it("makes the note under the typed title, then links it by its id where the [[ was", async () => {
    const { calls } = installFakeEditorHost();
    const editor = makeEditor("see ");
    const element = openPicker(editor);
    commitComboboxInput(editor, element, false);
    await createAndLink(editor, "Wading birds");
    expect(calls).toStrictEqual([
      { action: "createNote", args: [{ blocks: [], title: "Wading birds" }] },
    ]);
    expect(out(editor)).toBe("see [Wading birds](mention:note-1)\n");
  });

  it("leaves the words typed as text when the note was not made", async () => {
    installFakeEditorHost({ createNote: async () => await Promise.reject(new Error("offline")) });
    const editor = makeEditor("see ");
    const element = openPicker(editor);
    commitComboboxInput(editor, element, false);
    await createAndLink(editor, "Wading birds");
    expect(findByType(editor, KEYS.mention)).toBeNull();
    expect(editor.api.string([0])).toBe("see [[Wading birds]]");
  });
});
