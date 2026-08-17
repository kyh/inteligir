// What a keystroke may cost the chip field. `findThreadMarkers` is a whole
// document remark parse — ~78ms on a 50KB note — and the field rebuilds on
// every doc change, every selection move and every status effect. It must not
// be on any of those paths; the buffer's own incremental tree answers instead.

import { threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { afterEach, expect, test, vi } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { setThreadChips, threadChipsExtension } from "../thread-chip";

const { scans } = vi.hoisted(() => ({ scans: { count: 0 } }));

vi.mock("@repo/notes/markdown/thread-marker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/notes/markdown/thread-marker")>();
  return {
    ...actual,
    findThreadMarkers: (content: string) => {
      scans.count += 1;
      return actual.findThreadMarkers(content);
    },
  };
});

const ANC = "anc_0123456789ab";
const doc = `# Doc\n\nA paragraph to delegate.\n${threadMarkerText(ANC)}\n\n- [ ] a task\n`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  scans.count = 0;
});

test("typing into a note that HAS a marker costs no whole-document parse", () => {
  const mounted = createMarkdownEditor({
    parent: document.body,
    doc,
    extensions: [threadChipsExtension({ onOpen: () => {} })],
  });
  editor = mounted;
  mounted.view.dispatch({
    effects: setThreadChips.of({
      kind: "ready",
      chips: [{ anchor: ANC, tone: "busy", activity: "running", title: null, dismissable: false }],
    }),
  });
  expect(mounted.view.contentDOM.querySelectorAll(".cm-thread-chip")).toHaveLength(1);
  scans.count = 0;

  const at = doc.indexOf("delegate");
  for (let i = 0; i < 20; i += 1) {
    mounted.view.dispatch({ changes: { from: at + i, insert: "x" } });
  }

  expect(scans.count).toBe(0);
  // Still drawn, and still exactly one: the cheap answer is the same answer.
  expect(mounted.view.contentDOM.querySelectorAll(".cm-thread-chip")).toHaveLength(1);
});
