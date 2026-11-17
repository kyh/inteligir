// @vitest-environment jsdom
// patches/next@16.4.6.patch: the pages run Next's own react-dom, which reads the focused element's
// selection as text offsets before every commit, for a contenteditable a walk of the whole open note
// on every keystroke. The editor keeps its own selection, so the patch reads none there, as
// patches/react-dom@19.2.8.patch does for the npm copy the phone and the extension run; this suite
// fails without it.

import { createElement } from "next/dist/compiled/react";
import { flushSync } from "next/dist/compiled/react-dom";
import { createRoot } from "next/dist/compiled/react-dom/client";
import { describe, expect, it } from "vitest";

const note = (tick: number) =>
  createElement(
    "div",
    null,
    createElement(
      "div",
      { contentEditable: true, suppressContentEditableWarning: true },
      createElement("p", null, "first words"),
      createElement("p", null, "last words"),
    ),
    createElement("span", null, String(tick)),
  );

const textOf = (element: Element | null | undefined): Text => {
  const text = element?.firstChild;
  if (!(text instanceof Text)) {
    throw new TypeError("the paragraph holds its text");
  }
  return text;
};

describe("a commit of Next's react-dom while a contenteditable holds focus", () => {
  it("walks none of its text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => {
      root.render(note(0));
    });
    const editable = host.querySelector("[contenteditable]");
    if (!(editable instanceof HTMLElement)) {
      throw new TypeError("the note is drawn");
    }
    // jsdom implements no contentEditable property, which is what React asks, and focuses only an
    // element with a tab stop
    Object.defineProperty(editable, "contentEditable", { configurable: true, value: "true" });
    editable.tabIndex = 0;
    editable.focus();
    expect(document.activeElement).toBe(editable);
    getSelection()?.collapse(textOf(editable.firstElementChild), 0);

    // React's offsets add up each text node's length as the walk passes it
    let reads = 0;
    Object.defineProperty(textOf(editable.lastElementChild), "nodeValue", {
      configurable: true,
      get: () => {
        reads += 1;
        return "last words";
      },
    });

    flushSync(() => {
      root.render(note(1));
    });
    expect(host.textContent).toContain("1");
    expect(reads, "React walked the focused contenteditable's text before a commit").toBe(0);
    root.unmount();
    host.remove();
  });
});
