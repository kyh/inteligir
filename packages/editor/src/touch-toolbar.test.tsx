import { createRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point, TRange, Value } from "platejs";
import type { PlateEditor } from "platejs/react";

import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { GROUPS } from "@repo/editor/slash-items";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";
import { TOUCH_ACTIONS } from "@repo/editor/touch-toolbar";

import { EditorHarness } from "./test-support/editor-harness";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    error: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");

// every name a button may carry: a row of a table some other surface reads, never a literal
// of the toolbar's own, and never a chord, which a soft keyboard cannot press
const TABLE_LABELS = new Set([
  ...MARK_SHORTCUTS.map((row) => row.label),
  ...EDITOR_SHORTCUTS.map((row) => row.label),
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

  // the phone asks no agent, so the desktop's Ask agent has no row here
  it("draws no Ask agent on any host", () => {
    mount("body\n");
    const names = toolbarButtons().map((button) => button.getAttribute("aria-label"));
    expect(names).not.toContain("Ask agent");
  });

  it("keeps the editor's focus: every press cancels its pointerdown", () => {
    mount("body\n");
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
});

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

const writeAddress = async (text: string, submit: string): Promise<void> => {
  act(() => {
    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), {
      target: { value: text },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: submit }));
    await Promise.resolve();
  });
};

describe("a link from the touch toolbar", () => {
  afterEach(() => {
    for (const unregister of unregisters.splice(0)) {
      unregister();
    }
  });

  it("links the selection the field was opened over", async () => {
    const editor = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    await writeAddress("  https://example.com/  ", "Apply");

    expect(serializeNote(editor)).toBe("[one](https://example.com/) two\n");
  });

  it("lands nothing when the note is re-seeded under the open field, and keeps the address for the next one", async () => {
    const editor = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    act(() => {
      editor.tf.setValue(parsedValue("three four\n"));
    });

    await writeAddress("https://example.com/", "Apply");

    expect(serializeNote(editor)).toBe("three four\n");
    expect(toast.warning).toHaveBeenCalledWith("The item changed — select the text again.");

    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    expect(screen.getByRole("textbox", { name: "Link address" })).toHaveProperty(
      "value",
      "https://example.com/",
    );
  });

  it("writes nothing when cancelled", async () => {
    const editor = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    await writeAddress("https://example.com/", "Cancel");

    expect(serializeNote(editor)).toBe("one two\n");
  });
});
