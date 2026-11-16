import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import { GROUPS } from "@repo/editor/slash-items";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./test-support/editor-harness";

const PAGE = "https://example.com/embed";

const mounted = (): PlateEditor => {
  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={[{ children: [{ text: "x" }], type: "p" }]} />);
  const editor = ref.current;
  if (editor === null) {
    throw new Error("the harness did not hand over its editor");
  }
  editor.tf.select(editor.api.end([0]));
  return editor;
};

const embeds = (editor: PlateEditor): number =>
  editor.children.filter((node) => node.type === KEYS.mediaEmbed).length;

describe("the Embed row's prompt", () => {
  it("opens over the editor whose row ran, and its link lands in that editor alone", () => {
    installFakeEditorHost();
    const picked = mounted();
    const other = mounted();
    const row = GROUPS.flatMap(({ items }) => items).find((item) => item.value === "embed");

    act(() => {
      row?.onSelect(picked);
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: PAGE } });
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));

    expect([embeds(picked), embeds(other)]).toStrictEqual([1, 0]);
  });
});
