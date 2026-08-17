import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { posOf, stateWithStack, widgetRanges } from "./helpers";

const doc = `start here

\`\`\`mermaid
graph TD
  A[Buffer] --> B[File]
\`\`\`

\`\`\`js
const notADiagram = 1;
\`\`\`

\`\`\`mermaid
this is not a diagram anyone can draw
\`\`\`
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** The renderer is lazily imported, so the first fence of a session paints on
 *  a microtask; every assertion about painted output waits for it. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("mermaid decorations", () => {
  const state = stateWithStack(doc, 0);

  test("a mermaid fence folds to a block widget over its whole fence", () => {
    const from = posOf(doc, "```mermaid");
    const to = posOf(doc, "```\n\n```js") + 3;
    expect(widgetRanges(state.field(foldExtension))).toContainEqual([from, to]);
  });

  test("a non-mermaid fence is left to the ordinary code chrome", () => {
    const from = posOf(doc, "```js");
    expect(widgetRanges(state.field(foldExtension)).some(([start]) => start === from)).toBe(false);
  });

  test("a selection inside the fence reveals the source", () => {
    const from = posOf(doc, "```mermaid");
    const touching = stateWithStack(doc, from + 12);
    expect(widgetRanges(touching.field(foldExtension)).some(([start]) => start === from)).toBe(
      false,
    );
  });
});

describe("mermaid rendering", () => {
  test("the first fence paints an SVG, and the buffer is untouched", async () => {
    editor = createMarkdownEditor({ parent: document.body, doc });
    // Before the lazy chunk lands the widget shows the fence's own text —
    // never an empty gap.
    expect(editor.view.contentDOM.querySelector(".cm-mermaid-pending")).not.toBeNull();
    await settle();
    const svg = editor.view.contentDOM.querySelector(".cm-mermaid svg");
    expect(svg).not.toBeNull();
    expect(svg?.textContent).toContain("Buffer");
    expect(editor.getDoc()).toBe(doc);
  });

  test("a diagram it cannot draw renders the fence source AND the reason", async () => {
    editor = createMarkdownEditor({ parent: document.body, doc });
    await settle();
    const failed = editor.view.contentDOM.querySelector(".cm-mermaid-error");
    expect(failed).not.toBeNull();
    expect(failed?.querySelector(".cm-mermaid-source")?.textContent).toContain(
      "this is not a diagram anyone can draw",
    );
    expect(
      (failed?.querySelector(".cm-mermaid-error-message")?.textContent ?? "").length,
    ).toBeGreaterThan(0);
    expect(editor.getDoc()).toBe(doc);
  });

  test("a label carrying markup reaches the DOM as inert text, never as nodes", async () => {
    const hostile = '```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>"] --> B\n```\n';
    editor = createMarkdownEditor({ parent: document.body, doc: `start\n\n${hostile}` });
    await settle();
    const host = editor.view.contentDOM.querySelector(".cm-mermaid");
    expect(host).not.toBeNull();
    // The label survives as TEXT — it is the user's own diagram label.
    expect(host?.textContent).toContain("<img src=x onerror=alert(1)>");
    // What must not survive is any of it as markup. A raw-string assertion
    // would pass for the wrong reason: `onerror` legitimately appears inside
    // an escaped text node and a data- attribute, both inert.
    expect(host?.querySelectorAll("img, script, iframe, foreignObject").length).toBe(0);
    const handlers = [...(host?.querySelectorAll("*") ?? [])].flatMap((node) =>
      [...node.attributes].filter((attribute) => attribute.name.startsWith("on")),
    );
    expect(handlers).toEqual([]);
  });
});
