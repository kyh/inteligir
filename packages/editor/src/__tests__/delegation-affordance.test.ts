import { EditorSelection } from "@codemirror/state";
import { fireEvent } from "@testing-library/dom";
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
        defaultWriteMode: config.defaultWriteMode ?? (() => "direct"),
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

const requireButton = (buttons: HTMLButtonElement[], index: number): HTMLButtonElement => {
  const button = buttons[index];
  if (button === undefined) throw new Error(`no tooltip button at ${String(index)}`);
  return button;
};

describe("the delegation affordance", () => {
  test("a non-empty selection names its write mode: Delegate, Propose, Ask", () => {
    const onDelegateSelection = vi.fn();
    const mounted = mount({ onDelegateSelection });
    const from = posOf(doc, "A paragraph");
    const to = from + "A paragraph to delegate.".length;
    const selection = { from, to, text: "A paragraph to delegate." };
    mounted.view.dispatch({ selection: EditorSelection.single(from, to) });
    const buttons = tooltipButtons(mounted);
    expect(buttons.map((button) => button.textContent)).toEqual(["Delegate…", "Propose…", "Ask…"]);

    fireEvent.click(requireButton(buttons, 0));
    expect(onDelegateSelection).toHaveBeenCalledWith("do", "direct", selection);
    fireEvent.click(requireButton(buttons, 1));
    expect(onDelegateSelection).toHaveBeenCalledWith("do", "propose", selection);
    fireEvent.click(requireButton(buttons, 2));
    expect(onDelegateSelection).toHaveBeenCalledWith("ask", "direct", selection);
  });

  test("a caret on a task line offers the one-click fast path", () => {
    const onDelegateTask = vi.fn();
    const mounted = mount({ onDelegateTask });
    const taskPos = posOf(doc, "water the plants");
    mounted.view.dispatch({ selection: EditorSelection.single(taskPos) });
    const buttons = tooltipButtons(mounted);
    expect(buttons.map((button) => button.textContent)).toEqual(["Delegate task"]);
    fireEvent.click(requireButton(buttons, 0));
    expect(onDelegateTask).toHaveBeenCalledWith("direct", {
      from: posOf(doc, "- [ ] water"),
      to: posOf(doc, "- [ ] water") + "- [ ] water the plants".length,
      text: "- [ ] water the plants",
    });
  });

  test("the fast path's LABEL states the mode the setting will give it", () => {
    const onDelegateTask = vi.fn();
    const mounted = mount({ onDelegateTask, defaultWriteMode: () => "propose" });
    mounted.view.dispatch({
      selection: EditorSelection.single(posOf(doc, "water the plants")),
    });
    const buttons = tooltipButtons(mounted);
    expect(buttons.map((button) => button.textContent)).toEqual(["Propose task edit"]);
    fireEvent.click(requireButton(buttons, 0));
    expect(onDelegateTask).toHaveBeenCalledWith("propose", expect.anything());
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
