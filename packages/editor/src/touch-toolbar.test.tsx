import { createRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Point, TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { parseMarkdown, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { GROUPS } from "@repo/editor/slash-items";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host.test-utils";
import { TOUCH_ACTIONS } from "@repo/editor/touch-toolbar";

import { EditorHarness } from "./test-support/editor-harness.test-utils";

const { toast } = await import("@repo/ui/components/sonner");

vi.spyOn(toast, "error");

vi.spyOn(toast, "success");

vi.spyOn(toast, "warning");

const TABLE_LABELS = new Set([
  ...MARK_SHORTCUTS.map((row) => row.label),
  ...EDITOR_SHORTCUTS.map((row) => row.label),
  ...GROUPS.flatMap((group) => group.items.map((item) => item.label)),
  ...Object.values(TOUCH_ACTIONS).map((row) => row.label),
]);

const parsedValue = (markdown: string) => {
  const parsed = parseMarkdown(markdown);

  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }

  return parsed.value;
};

interface Mounted {
  readonly editor: PlateEditor;
  readonly turnReadOnly: (readOnly: boolean) => void;
}

const mount = (markdown: string, host: FakeEditorHostOptions = {}) => {
  installFakeEditorHost(host);
  const ref = createRef<PlateEditor>();
  const value = parsedValue(markdown);

  const { rerender } = render(<EditorHarness ref={ref} profile="touch" value={value} />, {
    reactStrictMode: true,
  });

  const editor = ref.current;

  if (editor === null) {
    throw new Error("the harness did not hand over its editor");
  }

  return {
    editor,
    turnReadOnly: (readOnly) => {
      act(() => {
        rerender(<EditorHarness ref={ref} profile="touch" value={value} readOnly={readOnly} />);
      });
    },
  } satisfies Mounted;
};

const toolbarButtons = () =>
  within(screen.getByRole("toolbar", { name: "Formatting" })).getAllByRole("button");

const press = (name: string) => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("the touch toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { editor } = mount("one two\n");
    act(() => {
      editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 3, path: [0, 0] } });
    });

    press(MARK_SHORTCUTS[0]?.label ?? "");
    expect(serializeNote(editor)).toBe("**one** two\n");

    press("Heading 1");
    expect(serializeNote(editor)).toBe("# **one** two\n");
  });

  it("indents and outdents the blocks Tab and Shift+Tab would", () => {
    const { editor } = mount("- one\n- two\n");
    act(() => {
      editor.tf.select({ offset: 3, path: [1, 0] });
    });

    press(TOUCH_ACTIONS.indent.label);
    expect(serializeNote(editor)).toBe("- one\n  - two\n");

    press(TOUCH_ACTIONS.outdent.label);
    expect(serializeNote(editor)).toBe("- one\n- two\n");
  });
});

const select = async (editor: PlateEditor, at: Point | TRange) => {
  await act(async () => {
    editor.tf.select(at);
    await Promise.resolve();
  });
};

const selectOne = async (editor: PlateEditor) => {
  await select(editor, {
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 3, path: [0, 0] },
  });
};

const writeAddress = async (text: string, submit: string) => {
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
  it("links the selection the field was opened over", async () => {
    const { editor } = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    await writeAddress("  https://example.com/  ", "Apply");

    expect(serializeNote(editor)).toBe("[one](https://example.com/) two\n");
  });

  it("lands nothing when the note is re-seeded under the open field, and keeps the address for the next one", async () => {
    const { editor } = mount("one two\n");
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

  it("closes the field as the note turns read-only, letting go of its words, so edits return to the row of buttons", async () => {
    const { editor, turnReadOnly } = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    turnReadOnly(true);
    turnReadOnly(false);

    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
    expect(screen.getByRole("button", { name: TOUCH_ACTIONS.link.label })).toBeDefined();
    expect(editor.api.rangeRefs().size).toBe(0);
  });

  it("writes nothing when cancelled", async () => {
    const { editor } = mount("one two\n");
    await selectOne(editor);
    press(TOUCH_ACTIONS.link.label);
    await writeAddress("https://example.com/", "Cancel");

    expect(serializeNote(editor)).toBe("one two\n");
  });
});
