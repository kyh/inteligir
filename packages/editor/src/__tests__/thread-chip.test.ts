import { EditorSelection } from "@codemirror/state";
import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import {
  setThreadChips,
  threadChipsExtension,
  type ThreadChipInfo,
  type ThreadChipState,
} from "../thread-chip";
import { posOf } from "./helpers";

const ANC = "anc_0123456789ab";
const OTHER = "anc_ffffffffffff";
const MARKER = threadMarkerText(ANC);
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

const pushState = (mounted: MarkdownEditor, state: ThreadChipState): void => {
  mounted.view.dispatch({ effects: setThreadChips.of(state) });
};

const pushChips = (mounted: MarkdownEditor, chips: ThreadChipInfo[]): void => {
  pushState(mounted, { kind: "ready", chips });
};

/** The app's payload, with the fields a test is not about defaulted. */
const chip = (anchor: string, over: Partial<ThreadChipInfo> = {}): ThreadChipInfo => ({
  anchor,
  tone: "busy",
  activity: "running",
  title: null,
  dismissable: false,
  ...over,
});

describe("the chip decoration", () => {
  test("a marker renders as a chip and the buffer keeps its bytes", () => {
    const mounted = mount();
    pushChips(mounted, [chip(ANC, { title: "Fix the intro" })]);
    const chips = chipElements(mounted);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.dataset["tone"]).toBe("busy");
    expect(chips[0]?.getAttribute("aria-label")).toBe("Delegation running");
    expect(chips[0]?.textContent).toContain("Fix the intro");
    expect(mounted.getDoc()).toBe(doc);
    expect(mounted.view.contentDOM.textContent).not.toContain("inteligir:thread");
  });

  test("a chip effect re-renders the chip without touching the doc", () => {
    const mounted = mount();
    pushChips(mounted, [chip(ANC)]);
    expect(chipElements(mounted)[0]?.dataset["tone"]).toBe("busy");
    pushChips(mounted, [chip(ANC, { tone: "positive", activity: "done" })]);
    expect(chipElements(mounted)[0]?.dataset["tone"]).toBe("positive");
    expect(chipElements(mounted)[0]?.textContent).toContain("done");
    expect(mounted.getDoc()).toBe(doc);
  });

  test("a selection touching the marker reveals the raw comment", () => {
    const mounted = mount();
    pushChips(mounted, [chip(ANC, { tone: "positive", activity: "done" })]);
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
    pushChips(mounted, [chip(ANC, { tone: "positive", activity: "done" })]);
    const element = chipElements(mounted)[0];
    if (element === undefined) {
      throw new Error("no chip");
    }
    fireEvent.click(element);
    expect(onOpen).toHaveBeenCalledWith(ANC);
  });
});

describe("an unanswered doc-threads query", () => {
  test("says the delegation is loading, not that no thread claims it", () => {
    const mounted = mount();
    const element = chipElements(mounted)[0];
    expect(element?.textContent).toContain("delegation");
    expect(mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss")).toBeNull();
  });

  test("an ANSWERED query with no match says so, and that IS dismissable", () => {
    const mounted = mount();
    pushChips(mounted, []);
    const element = chipElements(mounted)[0];
    expect(element?.textContent).toContain("no thread");
    expect(mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss")).not.toBeNull();
  });

  test("a chip the app claims nothing for does not open a thread on click", () => {
    const onOpen = vi.fn();
    const mounted = mount(doc, onOpen);
    const element = chipElements(mounted)[0];
    if (element === undefined) {
      throw new Error("no chip");
    }
    fireEvent.click(element);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("dismiss", () => {
  test("an archived chip removes exactly its own marker line", () => {
    const mounted = mount();
    pushChips(mounted, [chip(ANC, { tone: "muted", activity: "archived", dismissable: true })]);
    const dismiss = mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss");
    if (dismiss === null) {
      throw new Error("no dismiss affordance");
    }
    fireEvent.click(dismiss);
    expect(mounted.getDoc()).toBe(doc.replace(`\n${MARKER}`, ""));
  });

  test("an active chip offers no dismiss affordance", () => {
    const mounted = mount();
    pushChips(mounted, [chip(ANC)]);
    expect(mounted.view.contentDOM.querySelector(".cm-thread-chip-dismiss")).toBeNull();
  });

  test("with two markers, the clicked chip removes ITS range", () => {
    const twoMarkers = `Para.\n\n${threadMarkerText(OTHER)}\n\nOther para.\n${MARKER}\n`;
    const mounted = mount(twoMarkers);
    pushChips(mounted, [
      chip(OTHER, { tone: "muted", activity: "archived", dismissable: true }),
      chip(ANC, { tone: "muted", activity: "archived", dismissable: true }),
    ]);
    const dismissals = mounted.view.contentDOM.querySelectorAll(".cm-thread-chip-dismiss");
    expect(dismissals).toHaveLength(2);
    const second = dismissals[1];
    if (second === undefined) {
      throw new Error("no second dismiss");
    }
    fireEvent.click(second);
    // The FIRST marker survives; only the clicked one's line went.
    expect(mounted.getDoc()).toBe(`Para.\n\n${threadMarkerText(OTHER)}\n\nOther para.\n`);
  });
});

describe("recognition is syntax-aware in the buffer too", () => {
  test("marker-shaped text inside a fence renders no chip and stays visible", () => {
    const fenced = `Para.\n\n\`\`\`md\n${MARKER}\n\`\`\`\n`;
    const mounted = mount(fenced);
    pushChips(mounted, [chip(ANC, { tone: "positive", activity: "done" })]);
    expect(chipElements(mounted)).toHaveLength(0);
    expect(mounted.view.contentDOM.textContent).toContain("inteligir:thread");
  });

  test("marker-shaped text inside inline code renders no chip", () => {
    const mounted = mount(`Write \`${MARKER}\` to anchor.\n`);
    pushChips(mounted, [chip(ANC, { tone: "positive", activity: "done" })]);
    expect(chipElements(mounted)).toHaveLength(0);
  });
});
