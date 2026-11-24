import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TRange } from "platejs";
import type { PlateEditor } from "platejs/react";

import { parseMarkdown, serializeNote } from "@repo/editor/headless/codec/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";

import { EditorHarness } from "./test-support/editor-harness.test-utils";

const { toast } = await import("@repo/ui/components/sonner");

vi.spyOn(toast, "error");

vi.spyOn(toast, "success");

vi.spyOn(toast, "warning");

Range.prototype.getBoundingClientRect = () => new DOMRect();

const parsedValue = (markdown: string) => {
  const parsed = parseMarkdown(markdown);

  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }

  return parsed.value;
};

const ONE: TRange = { anchor: { offset: 0, path: [0, 0] }, focus: { offset: 3, path: [0, 0] } };

const select = async (editor: PlateEditor, words: TRange = ONE) => {
  await act(async () => {
    editor.tf.select(words);
    await Promise.resolve();
  });
};

interface Selected {
  readonly editor: PlateEditor;
  readonly turnReadOnly: (readOnly: boolean) => void;
}

const selectIn = async (markdown: string, words: TRange = ONE) => {
  installFakeEditorHost();
  const ref = createRef<PlateEditor>();
  const value = parsedValue(markdown);
  const { rerender } = render(<EditorHarness ref={ref} value={value} />, { reactStrictMode: true });
  const editor = ref.current;

  if (editor === null) {
    throw new Error("the harness did not hand over its editor");
  }

  await act(async () => {
    editor.tf.focus();
    await Promise.resolve();
  });
  await select(editor, words);

  return {
    editor,
    turnReadOnly: (readOnly) => {
      act(() => {
        rerender(<EditorHarness ref={ref} value={value} readOnly={readOnly} />);
      });
    },
  } satisfies Selected;
};

const openLinkField = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Link" }));

  return await screen.findByPlaceholderText("Paste or type a link…");
};

const apply = async (field: HTMLElement, url: string) => {
  fireEvent.change(field, { target: { value: url } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await Promise.resolve();
  });
};

describe("a link from the selection toolbar", () => {
  it("links the selected words", async () => {
    const { editor } = await selectIn("one two\n");
    await apply(await openLinkField(), "https://example.com/");

    expect(serializeNote(editor)).toBe("[one](https://example.com/) two\n");
  });

  it("gives a link already over the words the new address, where it nested one", async () => {
    const { editor } = await selectIn("[one](https://old.example/) two\n", {
      anchor: { offset: 0, path: [0, 1, 0] },
      focus: { offset: 3, path: [0, 1, 0] },
    });

    await apply(await openLinkField(), "https://new.example/");

    expect(serializeNote(editor)).toBe("[one](https://new.example/) two\n");
  });

  it("lands nothing when the note is re-seeded under the open field, says so, and keeps the address for the next one", async () => {
    const { editor } = await selectIn("one two\n");
    const field = await openLinkField();
    act(() => {
      editor.tf.setValue(parsedValue("three four\n"));
    });
    await apply(field, "https://example.com/");

    expect(serializeNote(editor)).toBe("three four\n");
    expect(toast.warning).toHaveBeenCalledWith("The item changed — select the text again.");

    await select(editor);
    expect(await openLinkField()).toHaveProperty("value", "https://example.com/");
  });

  it("gives the note its focus back on Escape, and links nothing", async () => {
    const { editor } = await selectIn("one two\n");
    const field = await openLinkField();
    const focus = vi.spyOn(editor.tf, "focus");
    fireEvent.change(field, { target: { value: "https://example.com/" } });
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });

    expect(serializeNote(editor)).toBe("one two\n");
    expect(focus).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText("Paste or type a link…")).toBeNull();
  });

  it("closes the open field as the note turns read-only, letting go of its words, so edits return to the plain bar", async () => {
    const { editor, turnReadOnly } = await selectIn("one two\n");
    await openLinkField();
    turnReadOnly(true);
    turnReadOnly(false);

    expect(screen.queryByPlaceholderText("Paste or type a link…")).toBeNull();
    expect(editor.api.rangeRefs().size).toBe(0);

    await select(editor, {
      anchor: { offset: 0, path: [0, 0] },
      focus: { offset: 0, path: [0, 0] },
    });
    await select(editor);
    expect(await screen.findByRole("button", { name: "Link" })).toBeDefined();
    expect(screen.queryByPlaceholderText("Paste or type a link…")).toBeNull();
  });
});
