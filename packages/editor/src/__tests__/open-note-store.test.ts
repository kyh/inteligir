// The real markdown gate runs here: mocking analyzeMarkdown would turn "is the
// verdict for these bytes?" into "was the mock called?".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeGateReason } from "@repo/editor/markdown/markdown-doc";
import { EMPTY_EDITOR_STATE } from "@repo/editor/vault-editor";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import type { OpenNoteState } from "@repo/editor/note/open-note-store";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");
const { createOpenNoteStore } = await import("@repo/editor/note/open-note-store");

let store = createOpenNoteStore();
const publishEditor: (typeof store)["publishEditor"] = (editor) => {
  store.publishEditor(editor);
};
const publishOpenPath: (typeof store)["publishOpenPath"] = (path, change) => {
  store.publishOpenPath(path, change);
};
const useOpenNote = {
  getInitialState: () => store.store.getInitialState(),
  getState: () => store.state(),
  setState: (partial: Partial<OpenNoteState>, replace?: boolean) => {
    if (replace === true) {
      store.store.setState(store.store.getInitialState(), true);
    } else {
      store.store.setState(partial);
    }
  },
  subscribe: (listener: (state: OpenNoteState) => void) =>
    store.store.subscribe((state) => {
      listener(state);
    }),
};

const RICH_PATH = "notes/a.md";
const OTHER_PATH = "notes/b.md";

// parses and round-trips byte-canonically
const RICH_MD = "# Hello\n\nA plain paragraph.\n";
const RICH_MD_2 = "# Hello\n\nA plain paragraph, revised.\n";
// the closing tag does not match, so the gate refuses Rich
const GATED_MD = "<Foo>centered</Bar>\n";
const GATED_MD_2 = "<Foo>again</Bar>\n";
const GATED_REASON = {
  kind: "parse-error",
  line: 1,
  message:
    "Unexpected closing tag `</Bar>`, expected corresponding closing tag for `<Foo>` (1:1-1:6)",
} as const;

class FakeController {
  private state: VaultEditorState = EMPTY_EDITOR_STATE;
  private readonly subs = new Set<() => void>();

  getState = (): VaultEditorState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  emit(patch: Partial<VaultEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.subs) {
      fn();
    }
  }

  // bytes from the IO (an open, a reload, a save's merge), as the controller marks them.
  load(patch: Partial<VaultEditorState>): void {
    this.emit({ ...patch, diskSeq: this.state.diskSeq + 1 });
  }

  // the buffer's own bytes: an edit, then the save that lands them unchanged.
  settle(content: string): void {
    this.emit({ content, dirty: true });
    this.emit({ dirty: false });
  }
}

// subscribe first, then publish once, so no emission slips between snapshot and subscription
const mountRuntime = (): FakeController => {
  const controller = new FakeController();
  controller.subscribe(() => {
    publishEditor(controller.getState());
  });
  publishEditor(controller.getState());
  return controller;
};

const openNote = (path: string, content: string): FakeController => {
  const controller = mountRuntime();
  publishOpenPath(path);
  controller.load({ content, dirty: false, path });
  return controller;
};

const recordStates = () => {
  const seen: OpenNoteState[] = [];
  const stop = useOpenNote.subscribe((s) => {
    seen.push(s);
  });
  return { seen, stop };
};

// one macrotask hop; under node the idle pass is a macrotask queued first, so it has run
const drain = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise-native form here
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const expectGateInLockstep = (seen: readonly OpenNoteState[]): void => {
  for (const s of seen) {
    if (s.editor.path === null) {
      continue;
    }
    expect(s.analyzed.path).toBe(s.editor.path);
  }
};

const richSnapshotsFor = (seen: readonly OpenNoteState[], path: string): OpenNoteState[] =>
  seen.filter(
    (s) =>
      s.openDoc.kind === "markdown" && s.openDoc.path === path && s.openDoc.surface.mode === "rich",
  );

// Plate re-seeds from whatever content a rich surface is handed, and its next keystroke saves
// what it made of those bytes.
const expectGatedWithItsBytes = (seen: readonly OpenNoteState[]): void => {
  const landed = seen.find((s) => s.editor.content === GATED_MD);
  expect(landed?.analyzed).toEqual({
    content: GATED_MD,
    path: RICH_PATH,
    rawReason: GATED_REASON,
  });
  expect(landed?.openDoc).toEqual({
    kind: "markdown",
    path: RICH_PATH,
    surface: { mode: "raw", reason: GATED_REASON },
  });
  expect(richSnapshotsFor(seen, RICH_PATH).filter((s) => s.editor.content === GATED_MD)).toEqual(
    [],
  );
};

describe("open-note-store publishEditor", () => {
  beforeEach(() => {
    store = createOpenNoteStore();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // drain first so no deferred analysis bleeds into the next test
    await drain();
    useOpenNote.setState(useOpenNote.getInitialState(), true);
  });

  it("gates a Raw-only file on the real markdown pipeline", () => {
    openNote(RICH_PATH, RICH_MD);
    expect(useOpenNote.getState().analyzed.rawReason).toBeNull();

    useOpenNote.setState(useOpenNote.getInitialState(), true);
    openNote(OTHER_PATH, GATED_MD);
    expect(useOpenNote.getState().analyzed.rawReason).toEqual(GATED_REASON);
  });

  describe("path change", () => {
    it("lands verdict + editor in ONE update — a Raw-only file is never shown rich", () => {
      openNote(RICH_PATH, RICH_MD);

      const { seen, stop } = recordStates();
      const controller = mountRuntime();
      publishOpenPath(OTHER_PATH);
      const beforeLoad = seen.length;
      controller.load({ content: GATED_MD, dirty: false, path: OTHER_PATH });
      stop();

      expect(seen.length - beforeLoad).toBe(1);

      const landed = seen.at(-1);
      expect(landed).toBeDefined();
      expect(landed?.editor.content).toBe(GATED_MD);
      expect(landed?.analyzed).toEqual({
        content: GATED_MD,
        path: OTHER_PATH,
        rawReason: GATED_REASON,
      });
      expect(landed?.openDoc).toEqual({
        kind: "markdown",
        path: OTHER_PATH,
        surface: { mode: "raw", reason: GATED_REASON },
      });

      expectGateInLockstep(seen);
      expect(richSnapshotsFor(seen, OTHER_PATH)).toEqual([]);
    });

    it("an in-place path swap never shows the new file through the old file's verdict", () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      const { seen, stop } = recordStates();
      publishOpenPath(OTHER_PATH);
      controller.load({ content: GATED_MD, dirty: false, path: OTHER_PATH });
      stop();

      expect(richSnapshotsFor(seen, OTHER_PATH)).toEqual([]);
      expectGateInLockstep(seen);
    });

    it("pops back to Rich when a settle clears the gate — the surface is the gate's alone", async () => {
      const controller = openNote(RICH_PATH, GATED_MD);
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: RICH_PATH,
        surface: { mode: "raw", reason: GATED_REASON },
      });

      controller.settle(RICH_MD);
      await drain();
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: RICH_PATH,
        surface: { mode: "rich" },
      });
    });
  });

  describe("bytes from disk on the open path", () => {
    it("gates a clean reload in the same update as its bytes", () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      const { seen, stop } = recordStates();
      controller.load({ content: GATED_MD, dirty: false });
      stop();

      expectGatedWithItsBytes(seen);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
    });

    it("gates a merge that leaves the buffer dirty in the same update as its bytes", () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      controller.emit({ content: RICH_MD_2, dirty: true });

      const { seen, stop } = recordStates();
      controller.load({ content: GATED_MD, dirty: true });
      stop();

      expectGatedWithItsBytes(seen);
    });
  });

  describe("deferred same-path analysis", () => {
    it("lands the settle first and analyzes once idle, not in a microtask", async () => {
      vi.useFakeTimers();
      try {
        const controller = openNote(RICH_PATH, RICH_MD);

        controller.emit({ content: GATED_MD, dirty: true });
        controller.emit({ dirty: false });
        // a microtask would have run the analysis by now, inside the settle's frame
        await Promise.resolve();

        expect(useOpenNote.getState().editor).toMatchObject({ content: GATED_MD, dirty: false });
        expect(useOpenNote.getState().analyzed).toEqual({
          content: RICH_MD,
          path: RICH_PATH,
          rawReason: null,
        });

        vi.runAllTimers();
        expect(useOpenNote.getState().analyzed).toEqual({
          content: GATED_MD,
          path: RICH_PATH,
          rawReason: GATED_REASON,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops a pass superseded by newer content on the same path", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      const { seen, stop } = recordStates();

      controller.settle(GATED_MD);
      controller.settle(RICH_MD_2);
      await drain();
      stop();

      expect(useOpenNote.getState().analyzed).toEqual({
        content: RICH_MD_2,
        path: RICH_PATH,
        rawReason: null,
      });
      expect(seen.some((s) => s.analyzed.content === GATED_MD)).toBe(false);
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expectGateInLockstep(seen);
    });

    it("collapses a burst of settles into exactly ONE analysis apply", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.settle(GATED_MD);
      controller.settle(RICH_MD_2);
      controller.settle(GATED_MD);

      const { seen, stop } = recordStates();
      await drain();
      stop();

      expect(seen.length).toBe(1);
      expect(useOpenNote.getState().analyzed).toEqual({
        content: GATED_MD,
        path: RICH_PATH,
        rawReason: GATED_REASON,
      });
    });

    it("drops a pass cancelled by a path change", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.settle(GATED_MD);
      const next = mountRuntime();
      publishOpenPath(OTHER_PATH);
      next.load({ content: RICH_MD, dirty: false, path: OTHER_PATH });
      await drain();

      expect(useOpenNote.getState().analyzed).toEqual({
        content: RICH_MD,
        path: OTHER_PATH,
        rawReason: null,
      });
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: OTHER_PATH,
        surface: { mode: "rich" },
      });
    });

    it("drops a pass whose buffer went dirty again, and re-runs on the next settle", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.settle(GATED_MD);
      // same bytes, so only `dirty` distinguishes this from the scheduled target
      controller.emit({ dirty: true });
      await drain();

      expect(useOpenNote.getState().analyzed).toEqual({
        content: RICH_MD,
        path: RICH_PATH,
        rawReason: null,
      });

      controller.emit({ dirty: false });
      await drain();
      expect(useOpenNote.getState().analyzed).toEqual({
        content: GATED_MD,
        path: RICH_PATH,
        rawReason: GATED_REASON,
      });
    });
  });

  describe("Rich→Raw flip toast", () => {
    it("fires once when a mid-session settle yanks Plate out from under the user", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.settle(GATED_MD);
      await drain();

      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
        `Switched to Raw editing — ${describeGateReason(GATED_REASON)}`,
      );
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: RICH_PATH,
        surface: { mode: "raw", reason: GATED_REASON },
      });
    });

    it("stays silent on a fresh open of a Raw-only file — it opens into the textarea", async () => {
      openNote(OTHER_PATH, GATED_MD);
      await drain();

      expect(useOpenNote.getState().analyzed.rawReason).toEqual(GATED_REASON);
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });

    it("stays silent when the note is already Raw — nothing visibly moved", async () => {
      const controller = openNote(RICH_PATH, GATED_MD);
      await drain();

      controller.settle(GATED_MD_2);
      await drain();

      expect(useOpenNote.getState().analyzed.content).toBe(GATED_MD_2);
      expect(useOpenNote.getState().analyzed.rawReason).not.toBeNull();
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });
});
