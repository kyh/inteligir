import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TRange, Value } from "platejs";
import type { PlateEditor } from "platejs/react";

import { parseMarkdown, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./test-support/editor-harness";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    error: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");

// jsdom lays nothing out, and the bar is placed against the selection's box
Range.prototype.getBoundingClientRect = () => new DOMRect();

const parsedValue = (markdown: string): Value => {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) {
    throw new Error(`the note must parse: ${parsed.reason.kind}`);
  }
  return parsed.value;
};

const ONE: TRange = { anchor: { offset: 0, path: [0, 0] }, focus: { offset: 3, path: [0, 0] } };

// the bar shows for an expanded selection in the focused editor, as a person's drag makes one;
// slate tells its listeners on a microtask, so the bar redraws a turn later
const selectIn = async (markdown: string, words: TRange = ONE): Promise<PlateEditor> => {
  installFakeEditorHost();
  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={parsedValue(markdown)} />);
  const editor = ref.current;
  if (editor === null) {
    throw new Error("the harness did not hand over its editor");
  }
  await act(async () => {
    editor.tf.focus();
    await Promise.resolve();
  });
  await act(async () => {
    editor.tf.select(words);
    await Promise.resolve();
  });
  return editor;
};

const openLinkField = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole("button", { name: "Link" }));
  return await screen.findByPlaceholderText("Paste or type a link…");
};

const apply = async (field: HTMLElement, url: string): Promise<void> => {
  fireEvent.change(field, { target: { value: url } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await Promise.resolve();
  });
};

describe("a link from the selection toolbar", () => {
  it("links the selected words", async () => {
    const editor = await selectIn("one two\n");
    await apply(await openLinkField(), "https://example.com/");

    expect(serializeNote(editor)).toBe("[one](https://example.com/) two\n");
  });

  it("gives a link already over the words the new address, where it nested one", async () => {
    const editor = await selectIn("[one](https://old.example/) two\n", {
      anchor: { offset: 0, path: [0, 1, 0] },
      focus: { offset: 3, path: [0, 1, 0] },
    });
    await apply(await openLinkField(), "https://new.example/");

    expect(serializeNote(editor)).toBe("[one](https://new.example/) two\n");
  });

  it("lands nothing when the note is re-seeded under the open field, and says so", async () => {
    const editor = await selectIn("one two\n");
    const field = await openLinkField();
    act(() => {
      editor.tf.setValue(parsedValue("three four\n"));
    });
    await apply(field, "https://example.com/");

    expect(serializeNote(editor)).toBe("three four\n");
    expect(toast.warning).toHaveBeenCalledWith("The item changed — select the text again.");
  });

  // jsdom keeps Slate's focus flag through the field's focus, so the hand-back is read off the call
  it("gives the note its focus back on Escape, and links nothing", async () => {
    const editor = await selectIn("one two\n");
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
});
