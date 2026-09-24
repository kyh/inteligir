import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

const { toast } = await import("@repo/ui/components/sonner");
const { insertTemplate } = await import("@repo/editor/insert-template");

const EMPTY: Value = [{ children: [{ text: "" }], type: "p" }];
const TEMPLATE = "templates/Deep.md";

const unregisters: (() => void)[] = [];

const openNote = () => {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value: EMPTY });
  editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 0, path: [0, 0] } });
  const unregister = registerLiveEditor("notes/today.md", editor);
  unregisters.push(unregister);
  return { editor, unregister };
};

describe("inserting a template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const unregister of unregisters.splice(0)) {
      unregister();
    }
  });

  it("lands the body at the caret of the note still open, titled after it", async () => {
    installFakeEditorHost({ readVaultFile: () => "---\ntags: [x]\n---\n# {{title}}\n" });
    const { editor } = openNote();

    await insertTemplate(editor, TEMPLATE);

    expect(editor.api.string([])).toBe("today");
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("says a template nested past the editor's reach could not land, and never rejects", async () => {
    installFakeEditorHost({ readVaultFile: () => `${"> ".repeat(3000)}x\n` });
    const { editor } = openNote();

    await expect(insertTemplate(editor, TEMPLATE)).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith("That template could not be parsed.");
    expect(editor.children).toEqual(EMPTY);
  });

  it("lands nothing in a note that closed while the template was read", async () => {
    installFakeEditorHost({ readVaultFile: () => "# Agenda\n" });
    const { editor, unregister } = openNote();
    const inserted = insertTemplate(editor, TEMPLATE);
    unregister();
    await inserted;

    expect(editor.children).toEqual(EMPTY);
    expect(toast.warning).toHaveBeenCalledWith(
      "The note closed before the template could be inserted.",
    );
  });
});
