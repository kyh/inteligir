import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { proposalMarksExtension, setProposalHunks, type ProposalHunkView } from "../proposal-marks";

const doc = ["# Notes", "", "alpha", "beta", "gamma", ""].join("\n");

const hunk = (over: Partial<ProposalHunkView> = {}): ProposalHunkView => ({
  proposalId: "prp_1",
  revision: 3,
  index: 0,
  baseStart: 2,
  baseEnd: 3,
  proposedLineCount: 1,
  ...over,
});

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (config: Partial<Parameters<typeof proposalMarksExtension>[0]> = {}) => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [
      proposalMarksExtension({
        onAccept: config.onAccept ?? (() => {}),
        onReject: config.onReject ?? (() => {}),
      }),
    ],
  });
  editor = mounted;
  return mounted;
};

const buttons = (mounted: MarkdownEditor, className: string): HTMLButtonElement[] =>
  Array.from(mounted.view.dom.querySelectorAll<HTMLButtonElement>(`.${className}`));

/** The actions must live INSIDE the text column, beside the lines they
 *  govern — the whole reason this is a widget and not a CodeMirror gutter. */
const actionsAreInsideTheContent = (mounted: MarkdownEditor): boolean =>
  Array.from(mounted.view.dom.querySelectorAll(".cm-proposal-actions")).every((node) =>
    mounted.view.contentDOM.contains(node),
  );

const markedLines = (mounted: MarkdownEditor): number =>
  mounted.view.dom.querySelectorAll(".cm-proposal-line").length;

const lineOfActions = (mounted: MarkdownEditor): string | null => {
  const actions = mounted.view.dom.querySelector(".cm-proposal-actions");
  return actions?.closest(".cm-line")?.textContent ?? null;
};

const requireButton = (found: HTMLButtonElement[]): HTMLButtonElement => {
  const button = found[0];
  if (button === undefined) throw new Error("no review button rendered");
  return button;
};

describe("proposal marks", () => {
  test("draws nothing until the app answers", () => {
    const mounted = mount();
    expect(markedLines(mounted)).toBe(0);
    expect(buttons(mounted, "cm-proposal-accept")).toHaveLength(0);
  });

  test("marks a hunk's lines and offers both verbs beside them", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const mounted = mount({ onAccept, onReject });
    const view = hunk();
    mounted.view.dispatch({ effects: setProposalHunks.of({ kind: "ready", hunks: [view] }) });

    expect(markedLines(mounted)).toBe(1);
    expect(actionsAreInsideTheContent(mounted)).toBe(true);
    fireEvent.click(requireButton(buttons(mounted, "cm-proposal-accept")));
    expect(onAccept).toHaveBeenCalledWith(view);
    fireEvent.click(requireButton(buttons(mounted, "cm-proposal-reject")));
    expect(onReject).toHaveBeenCalledWith(view);
  });

  test("a multi-line hunk marks every line it covers, with ONE action pair", () => {
    const mounted = mount();
    mounted.view.dispatch({
      effects: setProposalHunks.of({
        kind: "ready",
        hunks: [hunk({ baseStart: 2, baseEnd: 5, proposedLineCount: 1 })],
      }),
    });
    expect(markedLines(mounted)).toBe(3);
    expect(buttons(mounted, "cm-proposal-accept")).toHaveLength(1);
    // At the END of the region, so the pair trails the text it governs.
    expect(lineOfActions(mounted)).toBe("gamma✓✕");
  });

  test("an `unplaceable` answer draws nothing — the count is the doc bar's job", () => {
    const mounted = mount();
    mounted.view.dispatch({ effects: setProposalHunks.of({ kind: "unplaceable", count: 2 }) });
    expect(markedLines(mounted)).toBe(0);
    expect(buttons(mounted, "cm-proposal-accept")).toHaveLength(0);
  });

  test("typing STOPS the drawing: the hunk's line numbers describe the file, not the buffer", () => {
    const mounted = mount();
    mounted.view.dispatch({ effects: setProposalHunks.of({ kind: "ready", hunks: [hunk()] }) });
    expect(markedLines(mounted)).toBe(1);

    // One inserted line above the hunk moves every base line number under it;
    // mapping the decoration forward would leave the buttons pointing at text
    // the hunk never described.
    mounted.view.dispatch({ changes: { from: 0, insert: "prefix\n" } });
    expect(markedLines(mounted)).toBe(0);
    expect(buttons(mounted, "cm-proposal-accept")).toHaveLength(0);
  });

  test("the verbs carry the REVISION the hunks were derived from", () => {
    const onAccept = vi.fn();
    const mounted = mount({ onAccept });
    mounted.view.dispatch({
      effects: setProposalHunks.of({ kind: "ready", hunks: [hunk({ revision: 7, index: 2 })] }),
    });
    fireEvent.click(requireButton(buttons(mounted, "cm-proposal-accept")));
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ revision: 7, index: 2 }));
  });

  test("an insertion (zero-width base span) still gets its own actions", () => {
    const mounted = mount();
    mounted.view.dispatch({
      effects: setProposalHunks.of({
        kind: "ready",
        hunks: [hunk({ baseStart: 3, baseEnd: 3, proposedLineCount: 2 })],
      }),
    });
    expect(buttons(mounted, "cm-proposal-accept")).toHaveLength(1);
  });

  test("a hunk past the end of the document does not throw", () => {
    const mounted = mount();
    expect(() => {
      mounted.view.dispatch({
        effects: setProposalHunks.of({
          kind: "ready",
          hunks: [hunk({ baseStart: 900, baseEnd: 950 })],
        }),
      });
    }).not.toThrow();
  });
});
