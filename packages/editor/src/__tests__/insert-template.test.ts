import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlateEditor } from "platejs/react";
import { KEYS } from "platejs";
import type { Value } from "platejs";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { roundTrip } from "@repo/editor/markdown/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { expandTemplate } from "@repo/notes/templates/placeholders";

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

  it("lands the parsed blocks where the caret is", async () => {
    installFakeEditorHost({ readVaultFile: () => "## Agenda\n\n- one\n" });
    const { editor } = openNote();

    await insertTemplate(editor, TEMPLATE);

    expect(editor.children[0]?.type).toBe(editor.getType(KEYS.h2));
    expect(editor.api.string([])).toContain("one");
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

describe("a template through the editor", () => {
  it("round-trips byte-exact once its three placeholders are expanded, pills untouched", () => {
    const template =
      "# {{title}}\n\nOn {{date}} at {{time}}: {{2+2|4|id=total}} and {{date|day}}.\n";
    const expanded = expandTemplate(template, {
      now: new Date(2026, 8, 5, 9, 7),
      title: "Standup",
    });
    expect(expanded).toBe(
      "# Standup\n\nOn 2026-09-05 at 09:07: {{2+2|4|id=total}} and {{date|day}}.\n",
    );
    expect(roundTrip(expanded)).toBe(expanded);
  });
});
