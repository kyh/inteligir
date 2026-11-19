import { KEYS } from "platejs";
import { createPlateEditor, NavigationFeedbackPlugin } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";
import { mountNote } from "./test-support/memory-note.test-utils";
import { memoryNotes } from "./test-support/memory-notes.test-utils";

const notes = memoryNotes();

describe("the per-block store work a keystroke would pay", () => {
  beforeAll(() => {
    installFakeEditorHost({ notes });
  });

  it("is off in the editor the app mounts: no navigation flash, no flat-model toggle hider", async () => {
    const { editor } = await mountNote(notes, "note", "# Note\n\nBody.\n");
    expect(Object.keys(editor.plugins)).not.toContain(NavigationFeedbackPlugin.key);
    expect(Object.keys(createPlateEditor().plugins)).toContain(NavigationFeedbackPlugin.key);
    expect(editor.getPlugin({ key: KEYS.toggle }).render.aboveNodes).toBeUndefined();
  });
});
