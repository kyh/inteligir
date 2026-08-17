import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { posOf, stateWithStack, widgetRanges } from "./helpers";

const doc = `start here

![a diagram](assets/diagram.svg)

Inline ![tiny](assets/tiny.png) beside words.

![remote](https://example.com/x.png) and ![evil](javascript:alert(1)) and
![nowhere](../outside.png).

![reference][id] keeps its bytes.

[id]: assets/diagram.svg
`;

const resolveAsset = (src: string): string | null =>
  src.startsWith("assets/") ? `/served/${src}` : null;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (source = doc): MarkdownEditor =>
  createMarkdownEditor({ parent: document.body, doc: source, resolveAsset });

describe("image decorations", () => {
  const state = stateWithStack(doc, 0);
  const widgets = widgetRanges(state.field(foldExtension));

  test("an embed alone on its line folds to a block widget", () => {
    const from = posOf(doc, "![a diagram](assets/diagram.svg)");
    expect(widgets).toContainEqual([from, from + "![a diagram](assets/diagram.svg)".length]);
  });

  test("an embed inside a sentence folds inline", () => {
    const from = posOf(doc, "![tiny](assets/tiny.png)");
    expect(widgets).toContainEqual([from, from + "![tiny](assets/tiny.png)".length]);
  });

  test("a reference-style embed keeps its bytes", () => {
    const from = posOf(doc, "![reference][id]");
    expect(widgets.some(([start]) => start === from)).toBe(false);
  });

  test("a selection inside the embed reveals the source", () => {
    const from = posOf(doc, "![tiny](assets/tiny.png)");
    const touching = stateWithStack(doc, from + 3);
    expect(widgetRanges(touching.field(foldExtension)).some(([start]) => start === from)).toBe(
      false,
    );
  });
});

describe("image rendering", () => {
  test("a resolvable path becomes an <img> at the host's URL", () => {
    editor = mount();
    const images = [...editor.view.contentDOM.querySelectorAll("img.cm-image-img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/served/assets/diagram.svg",
      "/served/assets/tiny.png",
      "https://example.com/x.png",
    ]);
    expect(images[0]?.getAttribute("alt")).toBe("a diagram");
  });

  test("a javascript: src never reaches an <img>, and says why", () => {
    editor = mount();
    const errors = [...editor.view.contentDOM.querySelectorAll(".cm-image-error")];
    const sources = errors.map(
      (node) => node.querySelector(".cm-image-error-source")?.textContent ?? "",
    );
    expect(sources).toContain("![evil](javascript:alert(1))");
    const refused = errors.find((node) =>
      (node.querySelector(".cm-image-error-source")?.textContent ?? "").includes("javascript:"),
    );
    expect(refused?.querySelector(".cm-image-error-message")?.textContent).toBe(
      "javascript: images are not loaded",
    );
    // The refusal renders the SOURCE, so nothing is silently swallowed.
    expect(editor.view.contentDOM.querySelector('img[src^="javascript:"]')).toBeNull();
  });

  test("a path the host cannot resolve states that, and writes nothing", () => {
    editor = mount();
    const messages = [...editor.view.contentDOM.querySelectorAll(".cm-image-error-message")].map(
      (node) => node.textContent,
    );
    expect(messages).toContain("nothing here can resolve ../outside.png");
    expect(editor.getDoc()).toBe(doc);
  });

  test("with no resolver injected, a vault path refuses rather than guessing", () => {
    editor = createMarkdownEditor({
      parent: document.body,
      // Caret at 0, off the embed — an embed the selection touches is revealed
      // as source by design, which would pass this test for the wrong reason.
      doc: "start here\n\n![x](assets/tiny.png)\n",
    });
    expect(editor.view.contentDOM.querySelector("img.cm-image-img")).toBeNull();
    expect(editor.view.contentDOM.querySelector(".cm-image-error-message")?.textContent).toBe(
      "nothing here can resolve assets/tiny.png",
    );
  });
});
