import { act, render, within } from "@testing-library/react";
import { createRef } from "react";
import { PathApi } from "platejs";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import { serializeNote } from "@repo/editor/markdown/markdown-doc";
import { GROUPS } from "@repo/editor/slash-items";
import { CALLOUT_ALERT, CALLOUT_EDITING, CALLOUT_MARKER } from "@repo/editor/style-hooks";
import { meaningOf, readValue, rewrite } from "@repo/editor/test-support/markdown-meaning";

import { EditorHarness } from "./test-support/editor-harness";

const callout = GROUPS.flatMap(({ items }) => items).find((item) => item.value === "callout");

// Slate tells React of a change a microtask after it, so each step awaits its render
const calloutThenTyped = async (line: string) => {
  const ref = createRef<PlateEditor>();
  const view = render(
    <EditorHarness
      ref={ref}
      value={[
        { children: [{ text: "Heading" }], type: "h2" },
        { children: [{ text: line }], type: "p" },
      ]}
    />,
  );
  const editor = ref.current;
  if (editor === null || callout === undefined) {
    throw new Error("the harness and the Callout row must exist");
  }
  await act(async () => {
    editor.tf.select(editor.api.end([1]));
    callout.onSelect(editor);
    editor.tf.insertText("typed");
  });
  return { editor, view };
};

describe("the slash menu's Callout", () => {
  it.each([
    ["on an empty line", ""],
    ["after text", "x"],
  ])("takes what is typed next and writes a GitHub alert, %s", async (_where, line) => {
    const { editor } = await calloutThenTyped(line);
    const md = `## Heading\n\n> [!NOTE]\n> ${line}typed\n`;

    expect(editor.selection && PathApi.isAncestor([1], editor.selection.anchor.path)).toBe(true);
    expect(meaningOf(editor.children)).toBe(meaningOf(readValue(md)));
    expect(serializeNote(editor)).toBe(md);
    expect(rewrite(md)).toBe(md);
  });

  it("shows the Note label and hides its marker once the caret leaves", async () => {
    const { editor, view } = await calloutThenTyped("");
    await act(async () => {
      editor.tf.select(editor.api.end([0]));
    });

    const quote = view.container.querySelector(`blockquote.${CALLOUT_ALERT}`);
    if (!(quote instanceof HTMLElement)) {
      throw new TypeError("the callout must draw as an alert");
    }
    expect(quote.classList.contains(CALLOUT_EDITING)).toBe(false);
    expect(within(quote).getByText("Note")).toBeTruthy();
    const hidden = [...quote.querySelectorAll(`.${CALLOUT_MARKER}`)].map(
      (leaf) => leaf.textContent,
    );
    expect(hidden.join("").trim()).toBe("[!NOTE]");
  });
});
