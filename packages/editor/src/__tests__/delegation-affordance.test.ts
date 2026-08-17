import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import {
  delegationAffordanceExtension,
  type DelegationAffordanceConfig,
} from "../delegation-affordance";
import { posOf } from "./helpers";

const doc = `# Doc

A paragraph to delegate.

- [ ] water the plants
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (config: Partial<DelegationAffordanceConfig> = {}) => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [
      delegationAffordanceExtension({
        onDelegateSelection: config.onDelegateSelection ?? (() => {}),
        onDelegateTask: config.onDelegateTask ?? (() => {}),
      }),
    ],
  });
  editor = mounted;
  return mounted;
};

const tooltipButtons = (mounted: MarkdownEditor): HTMLButtonElement[] =>
  Array.from(mounted.view.dom.querySelectorAll<HTMLButtonElement>(".cm-delegate-button"));

describe("the delegation affordance", () => {
  test("a non-empty selection offers Delegate and Ask, carrying the selected text", () => {
    const onDelegateSelection = vi.fn();
    const mounted = mount({ onDelegateSelection });
    const from = posOf(doc, "A paragraph");
    const to = from + "A paragraph to delegate.".length;
    mounted.view.dispatch({ selection: EditorSelection.single(from, to) });
    const buttons = tooltipButtons(mounted);
    expect(buttons.map((button) => button.textContent)).toEqual(["Delegate…", "Ask…"]);
    buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDelegateSelection).toHaveBeenCalledWith("ask", {
      from,
      to,
      text: "A paragraph to delegate.",
    });
  });

  test("a caret on a task line offers the one-click fast path", () => {
    const onDelegateTask = vi.fn();
    const mounted = mount({ onDelegateTask });
    const taskPos = posOf(doc, "water the plants");
    mounted.view.dispatch({ selection: EditorSelection.single(taskPos) });
    const buttons = tooltipButtons(mounted);
    expect(buttons.map((button) => button.textContent)).toEqual(["Delegate task"]);
    buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDelegateTask).toHaveBeenCalledWith({
      from: posOf(doc, "- [ ] water"),
      to: posOf(doc, "- [ ] water") + "- [ ] water the plants".length,
      text: "- [ ] water the plants",
    });
  });

  test("a caret on an ordinary line shows nothing, and typing hides the tooltip", () => {
    const mounted = mount();
    mounted.view.dispatch({ selection: EditorSelection.single(posOf(doc, "paragraph")) });
    expect(tooltipButtons(mounted)).toHaveLength(0);

    const taskPos = posOf(doc, "water the plants");
    mounted.view.dispatch({ selection: EditorSelection.single(taskPos) });
    expect(tooltipButtons(mounted)).toHaveLength(1);
    mounted.view.dispatch({
      changes: { from: taskPos, insert: "x" },
      selection: EditorSelection.single(taskPos + 1),
    });
    expect(tooltipButtons(mounted)).toHaveLength(0);
  });
});
