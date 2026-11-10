import { ElementApi, KEYS, createSlateEditor } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { seedDoc } from "@repo/editor/live/note-blocks";
import { ownsPicker } from "@repo/editor/live/picker-owner";

import { liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";

const openPicker = (editor: SlateEditor): void => {
  editor.tf.insertNodes(
    { children: [{ text: "" }], type: KEYS.slashInput },
    { at: { offset: 3, path: [0, 0] } },
  );
};

const pickerIn = (editor: SlateEditor): TElement => {
  const [entry] = editor.api.nodes<TElement>({ at: [], match: { type: KEYS.slashInput } });
  if (entry === undefined || !ElementApi.isElement(entry[0])) {
    throw new Error("no picker is open");
  }
  return entry[0];
};

const seeded = (): Y.Doc => {
  const doc = new Y.Doc();
  seedDoc(doc, [
    {
      block: { children: [{ text: "one" }], id: "0190a000-0000-7000-8000-0000000000a1", type: "p" },
      section: "note",
    },
  ]);
  return doc;
};

describe("a picker open in a live note", () => {
  it("is the device's that opened it, and drawn inert on every other", () => {
    const mine = seeded();
    const theirs = syncedCopy(mine);
    const net = relay([mine, theirs]);
    const opener = liveEditor(mine, { kit: EDITOR_KIT });
    const other = liveEditor(theirs, { kit: EDITOR_KIT });

    openPicker(opener);
    settle(net, [opener, other]);

    expect(pickerIn(opener)).toMatchObject({ owner: mine.clientID });
    expect(ownsPicker(opener, pickerIn(opener))).toBe(true);
    expect(pickerIn(other)).toMatchObject({ owner: mine.clientID });
    expect(ownsPicker(other, pickerIn(other))).toBe(false);
  });

  it("is always its own editor's where no document is bound", () => {
    const editor = createSlateEditor({
      plugins: EDITOR_KIT,
      value: [{ children: [{ text: "one" }], type: "p" }],
    });
    openPicker(editor);
    expect(pickerIn(editor)).not.toHaveProperty("owner");
    expect(ownsPicker(editor, pickerIn(editor))).toBe(true);
  });
});
