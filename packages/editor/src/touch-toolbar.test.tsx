import { createRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point, TRange, Value } from "platejs";
import type { PlateEditor } from "platejs/react";

import { ANNOTATION_SHORTCUTS, HIGHLIGHT_SHORTCUT } from "@repo/editor/annotations/annotation-kit";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import type { AnnotationActions, PickImageResult } from "@repo/editor/host-io";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { GROUPS } from "@repo/editor/slash-items";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";
import { TOUCH_ACTIONS } from "@repo/editor/touch-toolbar";

import { EditorHarness } from "./test-support/editor-harness";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

const { toast } = await import("@repo/ui/components/sonner");

// every name a button may carry: a row of a table some other surface reads, never a literal
// of the toolbar's own, and never a chord, which a soft keyboard cannot press
const TABLE_LABELS = new Set([
  ...MARK_SHORTCUTS.map((row) => row.label),
  ...EDITOR_SHORTCUTS.map((row) => row.label),
  ...ANNOTATION_SHORTCUTS.map((row) => row.label),
  ...GROUPS.flatMap((group) => group.items.map((item) => item.label)),
  ...Object.values(TOUCH_ACTIONS).map((row) => row.label),
]);

const NOTE_PATH = "notes/touch.md";
const unregisters: (() => void)[] = [];

const parsedValue = (markdown: string): Value => {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }
  return parsed.value;
};

const mount = (markdown: string, host: FakeEditorHostOptions = {}): PlateEditor => {
  installFakeEditorHost(host);
  const ref = createRef<PlateEditor>();
  render(
    <EditorHarness
      ref={ref}
      profile="touch"
      store={createOpenNoteStore()}
      value={parsedValue(markdown)}
    />,
  );
  const editor = ref.current;
  if (editor === null) {
    throw new Error("the harness did not hand over its editor");
  }
  unregisters.push(registerLiveEditor(NOTE_PATH, editor));
  return editor;
};

const toolbarButtons = (): HTMLElement[] =>
  within(screen.getByRole("toolbar", { name: "Formatting" })).getAllByRole("button");

const press = (name: string): void => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("the touch toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const unregister of unregisters.splice(0)) {
      unregister();
    }
  });

  it("names every button by a table row, and draws every row it owns", () => {
    mount("body\n");
    const names = toolbarButtons().map((button) => button.getAttribute("aria-label"));

    for (const name of names) {
      expect(name !== null && TABLE_LABELS.has(name), `${String(name)} is no table row`).toBe(true);
    }
    const expected = [
      ...MARK_SHORTCUTS.map((row) => row.label),
      TOUCH_ACTIONS.indent.label,
      TOUCH_ACTIONS.outdent.label,
      TOUCH_ACTIONS.link.label,
      TOUCH_ACTIONS.undo.label,
      TOUCH_ACTIONS.redo.label,
      TOUCH_ACTIONS["hide-keyboard"].label,
    ];
    for (const label of expected) {
      expect(names, label).toContain(label);
    }
  });

  it("draws Ask agent and Highlight on every host, and no image button without a picker", () => {
    mount("body\n");
    const names = toolbarButtons().map((button) => button.getAttribute("aria-label"));
    expect(names).toContain(TOUCH_ACTIONS["ask-agent"].label);
    expect(names).toContain(HIGHLIGHT_SHORTCUT.label);
    expect(names).not.toContain(TOUCH_ACTIONS.image.label);
  });

  it("draws the image button once the host has a picker", () => {
    mount("body\n", { pickImage: async () => await Promise.resolve({ kind: "cancelled" }) });
    const names = toolbarButtons().map((button) => button.getAttribute("aria-label"));
    expect(names).toContain(TOUCH_ACTIONS.image.label);
  });

  it("keeps the editor's focus: every press cancels its pointerdown", () => {
    mount("body\n", { pickImage: async () => await Promise.resolve({ kind: "cancelled" }) });
    for (const button of toolbarButtons()) {
      const dispatched = fireEvent.pointerDown(button);
      expect(dispatched, `${String(button.getAttribute("aria-label"))} let focus move`).toBe(false);
    }
  });

  it("runs the row it names: a mark and a turn-into", () => {
    const editor = mount("one two\n");
    act(() => {
      editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 3, path: [0, 0] } });
    });

    press(MARK_SHORTCUTS[0]?.label ?? "");
    expect(serializeNote(editor)).toBe("**one** two\n");

    press("Heading 1");
    expect(serializeNote(editor)).toBe("# **one** two\n");
  });

  it("indents and outdents the blocks Tab and Shift+Tab would", () => {
    const editor = mount("- one\n- two\n");
    act(() => {
      editor.tf.select({ offset: 3, path: [1, 0] });
    });

    press(TOUCH_ACTIONS.indent.label);
    expect(serializeNote(editor)).toBe("- one\n  - two\n");

    press(TOUCH_ACTIONS.outdent.label);
    expect(serializeNote(editor)).toBe("- one\n- two\n");
  });

  it("lands a picked image as a paste lands it, and says why a refused one did not", async () => {
    const picks: PickImageResult[] = [
      { kind: "picked", path: "assets/photo.jpg" },
      { kind: "refused", message: "That photo is larger than the vault takes." },
    ];
    const editor = mount("body\n", {
      pickImage: async () => await Promise.resolve(picks.shift() ?? { kind: "cancelled" }),
    });
    act(() => {
      editor.tf.select({ offset: 4, path: [0, 0] });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: TOUCH_ACTIONS.image.label }));
      await Promise.resolve();
    });
    expect(serializeNote(editor)).toContain("![](assets/photo.jpg)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: TOUCH_ACTIONS.image.label }));
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith("That photo is larger than the vault takes.");
  });
});

const hostAnswering = (answer: boolean) => {
  const create = vi.fn<AnnotationActions["create"]>(async () => await Promise.resolve(answer));
  const edit = vi.fn<AnnotationActions["edit"]>(async () => await Promise.resolve(true));
  return { create, edit, host: { annotations: { create, edit, open: vi.fn() } } };
};

// slate tells its listeners on a microtask, so the toolbar redraws for a selection a turn later
const select = async (editor: PlateEditor, at: Point | TRange): Promise<void> => {
  await act(async () => {
    editor.tf.select(at);
    await Promise.resolve();
  });
};

const selectOne = async (editor: PlateEditor): Promise<void> => {
  await select(editor, {
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 3, path: [0, 0] },
  });
};

const writeNote = async (text: string, submit: string): Promise<void> => {
  act(() => {
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: text },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: submit }));
    await Promise.resolve();
  });
};

const highlightButton = (): HTMLElement =>
  screen.getByRole("button", { name: HIGHLIGHT_SHORTCUT.label });

describe("a highlight from the touch toolbar", () => {
  afterEach(() => {
    for (const unregister of unregisters.splice(0)) {
      unregister();
    }
  });

  it("is offered only over a selection with text, and never inside a code block", async () => {
    const { host } = hostAnswering(true);
    const editor = mount("one two\n\n```\ncode here\n```\n", host);

    await select(editor, { offset: 1, path: [0, 0] });
    expect(highlightButton()).toHaveProperty("disabled", true);

    await selectOne(editor);
    expect(highlightButton()).toHaveProperty("disabled", false);

    await select(editor, {
      anchor: { offset: 0, path: [1, 0, 0] },
      focus: { offset: 4, path: [1, 0, 0] },
    });
    expect(highlightButton()).toHaveProperty("disabled", true);
  });

  it("puts its markers in at Highlight, around the selection it was pressed on, and hands the host the id, the passage and the note", async () => {
    const { create, edit, host } = hostAnswering(true);
    const editor = mount("one two\n", host);
    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    expect(serializeNote(editor)).toBe("one two\n");

    await writeNote("  why this?  ", "Highlight");

    expect(create).toHaveBeenCalledTimes(1);
    const [id, quote] = create.mock.calls[0] ?? [];
    expect(quote).toBe("one");
    await vi.waitFor(() => {
      expect(edit).toHaveBeenCalledExactlyOnceWith(id, "why this?");
    });
    expect(serializeNote(editor)).toBe(`%%i:${String(id)}:start%%one%%i:${String(id)}:end%% two\n`);
  });

  it("strips the markers of a highlight the host refused, and writes it no note", async () => {
    const { create, edit, host } = hostAnswering(false);
    const editor = mount("one two\n", host);
    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    await writeNote("why?", "Highlight");

    expect(create).toHaveBeenCalledTimes(1);
    expect(serializeNote(editor)).toBe("one two\n");
    expect(edit).not.toHaveBeenCalled();
  });

  it("lands nothing when the note is re-seeded under the open field, and keeps the words for the next one", async () => {
    const { create, host } = hostAnswering(true);
    const editor = mount("one two\n", host);
    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    act(() => {
      editor.tf.setValue(parsedValue("three four\n"));
    });

    await writeNote("why this?", "Highlight");

    expect(create).not.toHaveBeenCalled();
    expect(serializeNote(editor)).toBe("three four\n");
    expect(toast.warning).toHaveBeenCalledWith("The item changed — select the text again.");

    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "why this?");
  });

  it("writes nothing when cancelled", async () => {
    const { create, host } = hostAnswering(true);
    const editor = mount("one two\n", host);
    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    await writeNote("never mind", "Cancel");

    expect(create).not.toHaveBeenCalled();
    expect(serializeNote(editor)).toBe("one two\n");
  });

  it("makes a bare highlight of an empty submit: the note is optional", async () => {
    const { create, edit, host } = hostAnswering(true);
    const editor = mount("one two\n", host);
    await selectOne(editor);
    press(HIGHLIGHT_SHORTCUT.label);
    await writeNote("   ", "Highlight");

    expect(create).toHaveBeenCalledTimes(1);
    const [id] = create.mock.calls[0] ?? [];
    expect(serializeNote(editor)).toBe(`%%i:${String(id)}:start%%one%%i:${String(id)}:end%% two\n`);
    await Promise.resolve();
    expect(edit).not.toHaveBeenCalled();
  });
});
