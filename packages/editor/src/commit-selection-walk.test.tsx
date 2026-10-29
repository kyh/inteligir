// patches/react-dom@19.2.8.patch: before every commit React reads the focused element's selection
// as text offsets, and for a contenteditable that is a walk of every node in it, the whole note on
// every keystroke and every scroll frame a commit rides. The editor keeps its own selection, so the
// patch reads none there; this suite fails without it.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

interface NoteProps {
  readonly tick: number;
}

const Note = ({ tick }: NoteProps) => (
  <div>
    <div data-testid="editable" contentEditable suppressContentEditableWarning>
      <p>first words</p>
      <p>last words</p>
    </div>
    <span>{tick}</span>
  </div>
);

const textOf = (element: Element | null | undefined): Text => {
  const text = element?.firstChild;
  if (!(text instanceof Text)) {
    throw new TypeError("the paragraph holds its text");
  }
  return text;
};

describe("a commit while a contenteditable holds focus", () => {
  it("walks none of its text", () => {
    const view = render(<Note tick={0} />);
    const editable = view.getByTestId("editable");
    // jsdom implements no contentEditable property, which is what React asks, and focuses only an
    // element with a tab stop
    Object.defineProperty(editable, "contentEditable", { configurable: true, value: "true" });
    editable.tabIndex = 0;
    editable.focus();
    expect(document.activeElement).toBe(editable);
    const first = textOf(editable.firstElementChild);
    getSelection()?.collapse(first, 0);

    // React's offsets add up each text node's length as the walk passes it
    let reads = 0;
    const last = textOf(editable.lastElementChild);
    Object.defineProperty(last, "nodeValue", {
      configurable: true,
      get: () => {
        reads += 1;
        return "last words";
      },
    });

    view.rerender(<Note tick={1} />);
    expect(view.getByText("1")).toBeTruthy();
    expect(reads, "React walked the focused contenteditable's text before a commit").toBe(0);
  });
});
