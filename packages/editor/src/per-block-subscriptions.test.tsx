// A store atom every block holds is recomputed on every change, so a keystroke in a long item
// pays for each block. Plate's navigation flash and its flat-model toggle hider each hold one,
// read no block's content, and so leave no stack in the typing budget's watched block: the
// budget's ratio alone would only catch them by timing. Here they are held off by name.

import { KEYS } from "platejs";
import { createPlateEditor, NavigationFeedbackPlugin } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { mountNote } from "./test-support/memory-note";
import { memoryNotes } from "./test-support/memory-notes";

const notes = memoryNotes();

describe("the per-block store work a keystroke would pay", () => {
  beforeAll(() => {
    installFakeEditorHost({ notes });
  });

  it("is off in the editor the app mounts: no navigation flash, no flat-model toggle hider", async () => {
    const { editor } = await mountNote(notes, "note", "# Note\n\nBody.\n");
    // a plugin switched off is never registered
    expect(Object.keys(editor.plugins)).not.toContain(NavigationFeedbackPlugin.key);
    expect(Object.keys(createPlateEditor().plugins)).toContain(NavigationFeedbackPlugin.key);
    expect(editor.getPlugin({ key: KEYS.toggle }).render.aboveNodes).toBeUndefined();
  });
});
