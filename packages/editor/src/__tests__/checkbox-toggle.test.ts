import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";

const doc = `# Todo

- [ ] buy milk
- [x] shipped
1. [ ] numbered task

> - [ ] quoted task
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (): { editor: MarkdownEditor; userEvents: string[] } => {
  const userEvents: string[] = [];
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const event = tr.annotation(Transaction.userEvent);
          if (event !== undefined) userEvents.push(event);
        }
      }),
    ],
  });
  editor = mounted;
  return { editor: mounted, userEvents };
};

const checkboxes = (view: EditorView): HTMLInputElement[] =>
  Array.from(view.contentDOM.querySelectorAll("input.cm-task-checkbox"));

const clickNthCheckbox = (view: EditorView, index: number): void => {
  const box = checkboxes(view)[index];
  if (!box) throw new Error(`no checkbox at index ${String(index)}`);
  box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("checkbox toggle", () => {
  test("all four tasks render as checkbox widgets", () => {
    const { editor: e } = mount();
    const boxes = checkboxes(e.view);
    expect(boxes).toHaveLength(4);
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false, false]);
  });

  test("click round-trips the exact buffer bytes", () => {
    const { editor: e, userEvents } = mount();

    clickNthCheckbox(e.view, 0);
    expect(e.getDoc()).toBe(doc.replace("- [ ] buy milk", "- [x] buy milk"));
    expect(userEvents).toContain("input.toggle-checkbox");

    clickNthCheckbox(e.view, 0);
    expect(e.getDoc()).toBe(doc);
  });

  test("unchecking rewrites exactly one character", () => {
    const { editor: e } = mount();
    clickNthCheckbox(e.view, 1);
    expect(e.getDoc()).toBe(doc.replace("- [x] shipped", "- [ ] shipped"));
  });

  test("ordered-list and blockquoted tasks toggle too", () => {
    const { editor: e } = mount();
    clickNthCheckbox(e.view, 2);
    expect(e.getDoc()).toBe(doc.replace("1. [ ] numbered task", "1. [x] numbered task"));
    clickNthCheckbox(e.view, 3);
    expect(e.getDoc()).toBe(
      doc
        .replace("1. [ ] numbered task", "1. [x] numbered task")
        .replace("> - [ ] quoted task", "> - [x] quoted task"),
    );
  });
});
