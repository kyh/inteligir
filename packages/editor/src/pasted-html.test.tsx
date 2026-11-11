// @vitest-environment jsdom

// HTML pasted into the live editor as a host mounts it, read as the block a pause would write.

import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlateEditor } from "platejs/react";
import { ElementApi } from "platejs";

import { stringProp } from "@repo/editor/node-props";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { blockOfElement } from "./live/element-block";
import { EditorHarness } from "./test-support/editor-harness";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable="true"]') !== null;
    },
  });
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

const paste = (html: string): PlateEditor => {
  installFakeEditorHost();
  const ref = createRef<PlateEditor>();
  const view = render(
    <EditorHarness ref={ref} nodeIds value={[{ children: [{ text: "" }], type: "p" }]} />,
  );
  const editable = view.container.querySelector("[data-slate-editor]");
  const editor = ref.current;
  if (!(editable instanceof HTMLElement) || editor === null) {
    throw new Error("the harness drew no editor");
  }
  editor.tf.select(editor.api.end([0]));
  fireEvent.paste(editable, {
    clipboardData: {
      files: [],
      getData: (type: string) => (type === "text/html" ? html : ""),
      items: [],
      types: ["text/html"],
    },
  });
  return editor;
};

const listStyles = (editor: PlateEditor): (string | undefined)[] =>
  editor.children.map((node) => stringProp(node, "listStyleType"));

const storesEveryBlock = (editor: PlateEditor): boolean =>
  editor.children.every((node) => ElementApi.isElement(node) && blockOfElement(node) !== null);

// a nested list as Google Docs copies it: each level its own list, styled inline
const DOCS_LIST =
  '<ul style="list-style-type:disc"><li aria-level="1">one</li>' +
  '<ul style="list-style-type:circle"><li aria-level="2">two</li></ul></ul>';

describe("a list pasted from a page", () => {
  it.each<[string, string, string[]]>([
    ["a nested Docs list", DOCS_LIST, ["disc", "disc"]],
    ["a square bullet", '<ul><li style="list-style-type:square">one</li></ul>', ["disc"]],
    ["a list with no marker", '<ul style="list-style-type:none"><li>one</li></ul>', ["disc"]],
    [
      "a lettered outline",
      '<ol style="list-style-type:lower-alpha"><li>one</li><li>two</li></ol>',
      ["decimal", "decimal"],
    ],
    ["a roman list", '<ol style="list-style-type:lower-roman"><li>one</li></ol>', ["decimal"]],
    ["a plain list", "<ol><li>one</li></ol><ul><li>two</li></ul>", ["decimal", "disc"]],
  ])("keeps %s as a list the library stores", (_, html, styles) => {
    const editor = paste(html);
    expect(listStyles(editor)).toStrictEqual(styles);
    expect(storesEveryBlock(editor)).toBe(true);
  });

  it("keeps a styled list inside a table as one the library stores", () => {
    const html =
      '<table><tr><td><ul style="list-style-type:circle"><li>one</li></ul></td></tr></table>';
    expect(storesEveryBlock(paste(html))).toBe(true);
  });

  it("leaves a list item with no list around it a plain paragraph", () => {
    expect(listStyles(paste("<li>one</li>"))).toStrictEqual([undefined]);
  });
});
