// The real markdown gate runs here: mocking analyzeMarkdown would turn "is the
// verdict for these bytes?" into "was the mock called?".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeGateReason } from "@repo/editor/markdown/markdown-doc";
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

const ROOT = "/vault";
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
  private state: VaultEditorState = {
    content: "",
    dirty: false,
    path: null,
    root: ROOT,
    saving: false,
  };
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
  controller.emit({ content, dirty: false, path });
  return controller;
};

const recordStates = () => {
  const seen: OpenNoteState[] = [];
  const stop = useOpenNote.subscribe((s) => {
    seen.push(s);
  });
  return { seen, stop };
};

// one macrotask hop, so every queued microtask drains without counting promise ticks
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
      controller.emit({ content: GATED_MD, dirty: false, path: OTHER_PATH });
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
      controller.emit({ content: GATED_MD, dirty: false, path: OTHER_PATH });
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

      controller.emit({ content: RICH_MD, dirty: false });
      await drain();
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: RICH_PATH,
        surface: { mode: "rich" },
      });
    });
  });

  describe("deferred same-path analysis", () => {
    it("defers to a microtask rather than blocking the settle", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.emit({ content: GATED_MD, dirty: true });
      controller.emit({ dirty: false });

      expect(useOpenNote.getState().analyzed.content).toBe(RICH_MD);
      expect(useOpenNote.getState().analyzed.rawReason).toBeNull();

      await drain();
      expect(useOpenNote.getState().analyzed).toEqual({
        content: GATED_MD,
        path: RICH_PATH,
        rawReason: GATED_REASON,
      });
    });

    it("drops a pass superseded by newer content on the same path", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      const { seen, stop } = recordStates();

      controller.emit({ content: GATED_MD, dirty: false });
      controller.emit({ content: RICH_MD_2, dirty: false });
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

      controller.emit({ content: GATED_MD, dirty: false });
      controller.emit({ content: RICH_MD_2, dirty: false });
      controller.emit({ content: GATED_MD, dirty: false });

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

      controller.emit({ content: GATED_MD, dirty: false });
      const next = mountRuntime();
      publishOpenPath(OTHER_PATH);
      next.emit({ content: RICH_MD, dirty: false, path: OTHER_PATH });
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

      controller.emit({ content: GATED_MD, dirty: false });
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

      controller.emit({ content: GATED_MD, dirty: false });
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

      controller.emit({ content: GATED_MD_2, dirty: false });
      await drain();

      expect(useOpenNote.getState().analyzed.content).toBe(GATED_MD_2);
      expect(useOpenNote.getState().analyzed.rawReason).not.toBeNull();
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });
});
