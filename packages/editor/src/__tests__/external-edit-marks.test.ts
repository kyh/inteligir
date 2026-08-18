import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import {
  EXTERNAL_EDIT_FADE_MS,
  externalEditMarksExtension,
  externalEditRanges,
} from "../external-edit-marks";

const DOC = "# Notes\n\none\n\ntwo\n";

let editor: MarkdownEditor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.useRealTimers();
});

const mount = (doc = DOC): MarkdownEditor => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [externalEditMarksExtension],
  });
  editor = mounted;
  return mounted;
};

/** Only the timers: CodeMirror's measure pass rides rAF, and faking that
 *  stalls the view rather than the fade under test. */
const fakeTimers = (): void => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
};

const marked = (mounted: MarkdownEditor): string[] =>
  externalEditRanges(mounted.view.state).map((range) =>
    mounted.view.state.doc.sliceString(range.from, range.to),
  );

describe("attributing an external write", () => {
  test("the spans an external replacement put in the buffer are marked", () => {
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\none\n\ntwo and a half\n");
    expect(marked(mounted)).toEqual(["two and a half"]);
    expect(mounted.view.dom.querySelector(".cm-external-edit")).not.toBeNull();
  });

  test("each hunk of a multi-part write is marked on its own", () => {
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\nONE\n\ntwo\n\nthree\n");
    expect(marked(mounted)).toEqual(["ONE", "three"]);
  });

  test("the user's own typing is never attributed", () => {
    const mounted = mount();
    mounted.view.dispatch({
      changes: { from: DOC.indexOf("one"), insert: "my " },
      selection: EditorSelection.single(DOC.indexOf("one") + 3),
      userEvent: "input.type",
    });
    expect(marked(mounted)).toEqual([]);
  });

  test("a second write replaces the attribution instead of stacking on it", () => {
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\none\n\ntwo and a half\n");
    mounted.replaceDoc("# Notes\n\none\n\ntwo and three quarters\n");
    expect(marked(mounted)).toEqual(["two and three quarters"]);
  });

  test("a pure deletion leaves nothing to tint — the stated residual", () => {
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\none\n");
    expect(marked(mounted)).toEqual([]);
  });

  test("the marks fade out on their own", () => {
    fakeTimers();
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\none\n\ntwo and a half\n");
    expect(marked(mounted)).toEqual(["two and a half"]);
    vi.advanceTimersByTime(EXTERNAL_EDIT_FADE_MS);
    expect(marked(mounted)).toEqual([]);
    expect(mounted.view.dom.querySelector(".cm-external-edit")).toBeNull();
  });

  test("a second write restarts the window rather than inheriting it", () => {
    fakeTimers();
    const mounted = mount();
    mounted.replaceDoc("# Notes\n\none\n\ntwo and a half\n");
    vi.advanceTimersByTime(EXTERNAL_EDIT_FADE_MS - 100);
    mounted.replaceDoc("# Notes\n\none\n\ntwo and three quarters\n");
    vi.advanceTimersByTime(200);
    expect(marked(mounted)).toEqual(["two and three quarters"]);
  });
});

describe("undo history", () => {
  test("neither the write nor the fade spends the user's undo", () => {
    fakeTimers();
    const mounted = mount();
    const at = DOC.indexOf("one") + 3;
    mounted.view.dispatch({
      changes: { from: at, insert: "!" },
      selection: EditorSelection.single(at + 1),
      userEvent: "input.type",
    });
    expect(mounted.getDoc()).toBe("# Notes\n\none!\n\ntwo\n");

    mounted.replaceDoc("# Notes\n\none!\n\ntwo\n\nthree\n");
    vi.advanceTimersByTime(EXTERNAL_EDIT_FADE_MS);
    expect(marked(mounted)).toEqual([]);

    undo(mounted.view);
    // The typed "!" is gone; the external line the disk holds is untouched.
    expect(mounted.getDoc()).toBe("# Notes\n\none\n\ntwo\n\nthree\n");
  });
});
