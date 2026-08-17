import { EditorSelection } from "@codemirror/state";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { setThreadChips, threadChipsExtension, type ThreadChipInfo } from "../thread-chip";
import { posOf } from "./helpers";

const MARKER = threadMarkerText("anc_test1");
const doc = `# Doc

A paragraph to delegate.
${MARKER}

- [ ] a task
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (initialDoc = doc, onOpen: (anchor: string) => void = () => {}) => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc: initialDoc,
    extensions: [threadChipsExtension({ onOpen })],
  });
  editor = mounted;
  return mounted;
};

const chipElements = (mounted: MarkdownEditor): HTMLElement[] =>
  Array.from(mounted.view.contentDOM.querySelectorAll<HTMLElement>(".cm-thread-chip"));

const pushChips = (mounted: MarkdownEditor, chips: ThreadChipInfo[]): void => {
  mounted.view.dispatch({ effects: setThreadChips.of(chips) });
};

describe("the chip decoration", () => {
  test("a marker renders as a chip and the buffer keeps its bytes", () => {
    const mounted = mount();
    pushChips(mounted, [{ anchor: "anc_test1", status: "running", title: "Fix the intro" }]);
    const chips = chipElements(mounted);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.dataset["status"]).toBe("running");
    expect(chips[0]?.textContent).toContain("Fix the intro");
    expect(mounted.getDoc()).toBe(doc);
    expect(mounted.view.contentDOM.textContent).not.toContain("inteligir:thread");
  });

  test("a status effect re-renders the chip without touching the doc", () => {
    const mounted = mount();
    pushChips(mounted, [{ anchor: "anc_test1", status: "running", title: null }]);
    expect(chipElements(mounted)[0]?.dataset["status"]).toBe("running");
    pushChips(mounted, [{ anchor: "anc_test1", status: "done", title: null }]);
    expect(chipElements(mounted)[0]?.dataset["status"]).toBe("done");
    expect(mounted.getDoc()).toBe(doc);
  });

  test("a marker with no matching thread renders as an unknown chip", () => {
    const mounted = mount();
    pushChips(mounted, []);
    expect(chipElements(mounted)[0]?.dataset["status"]).toBe("unknown");
  });

  test("a selection touching the marker reveals the raw comment", () => {
    const mounted = mount();
    pushChips(mounted, [{ anchor: "anc_test1", status: "done", title: null }]);
    const inside = posOf(doc, "inteligir:thread");
    mounted.view.dispatch({ selection: EditorSelection.single(inside) });
    expect(chipElements(mounted)).toHaveLength(0);
    expect(mounted.view.contentDOM.textContent).toContain("inteligir:thread");
    mounted.view.dispatch({ selection: EditorSelection.single(0) });
    expect(chipElements(mounted)).toHaveLength(1);
  });

  test("clicking the chip opens its thread", () => {
    const onOpen = vi.fn();
    const mounted = mount(doc, onOpen);
    pushChips(mounted, [{ anchor: "anc_test1", status: "done", title: null }]);
    chipElements(mounted)[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith("anc_test1");
  });

  test("dismissing an archived chip deletes exactly the marker line", () => {
    const mounted = mount();
    pushChips(mounted, [{ anchor: "anc_test1", status: "archived", title: null }]);
    const dismiss = mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss");
    expect(dismiss).not.toBeNull();
    dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mounted.getDoc()).toBe(doc.replace(`\n${MARKER}`, ""));
  });

  test("an active chip offers no dismiss affordance", () => {
    const mounted = mount();
    pushChips(mounted, [{ anchor: "anc_test1", status: "running", title: null }]);
    expect(mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss")).toBeNull();
  });
});
