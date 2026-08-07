// open-note-store's gate-analysis state machine (publishEditor) — the delicate
// part of the workspace's cadence split. It runs outside a React render phase,
// where the re-render loop would implicitly supply the "one consistent
// snapshot" guarantee, so the store has to supply it explicitly.
// The pure half (deriveOpenDoc) is covered by open-doc.test.ts; this covers the
// TIMING half, which is where the real hazards live:
//
//   1. A path change must land gate verdict + editor + mode in ONE store
//      update. A torn intermediate — the new file's bytes paired with the old
//      file's verdict — would mount Plate against unparseable content, and the
//      first Rich save would write mangled bytes over the user's file.
//   2. A same-path settle defers the (expensive) analysis to a microtask and
//      must DROP itself when the world moved on — superseded content, a path
//      change, or a buffer that went dirty again. A stale pass applying would
//      pin a verdict to bytes that are no longer in the buffer.
//   3. The Rich→Raw flip toast explains a surface swap the user did not ask
//      for. It must not fire on a fresh open (the Raw badge covers that) or
//      while the user is already looking at the textarea.
//
// The real markdown gate runs here on purpose: mocking analyzeMarkdown would
// turn "is the verdict for these bytes?" into "was the mock called?", and the
// point of this file is that a future refactor of the machine fails loudly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeGateReason } from "@repo/editor/markdown/markdown-doc";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import type { OpenNoteState } from "@repo/editor/note/open-note-store";

// The gate-flip toast is this machine's only effect outside the store.
vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");
const { publishEditor, publishOpenPath, setOpenNoteMode, useOpenNote } =
  await import("@repo/editor/note/open-note-store");

const ROOT = "/vault";
const RICH_PATH = "notes/a.md";
const OTHER_PATH = "notes/b.md";

// Rich-capable: parses in-vocabulary and round-trips byte-canonically.
const RICH_MD = "# Hello\n\nA plain paragraph.\n";
const RICH_MD_2 = "# Hello\n\nA plain paragraph, revised.\n";
// Raw-only: `<div>` is outside the MDX vocabulary, so the gate refuses Rich
// (unknown-jsx). Asserted below rather than assumed.
const GATED_MD = '<div align="center">centered</div>\n';

/** The smallest stand-in for the slice of VaultEditorController the provider's
 * publish subscription touches: a state snapshot plus subscribers. The test
 * drives `emit` wherever the real controller's open/edit/flush would, so the
 * store sees the same emission shapes and ordering it sees in production. */
class FakeController {
  private state: VaultEditorState = {
    root: ROOT,
    path: null,
    content: "",
    dirty: false,
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
    for (const fn of this.subs) fn();
  }
}

/** Mirror vault-context's `ensureRuntime` wiring: subscribe first, then publish
 * once, so no emission can slip between snapshot and subscription. */
function mountRuntime(): FakeController {
  const controller = new FakeController();
  controller.subscribe(() => publishEditor(controller.getState()));
  publishEditor(controller.getState());
  return controller;
}

/** Open a note the way the provider does: a fresh runtime publishes its empty
 * state, the intent path lands, then the read resolves with the file's bytes. */
function openNote(path: string, content: string): FakeController {
  const controller = mountRuntime();
  publishOpenPath(path);
  controller.emit({ path, content, dirty: false });
  return controller;
}

/** Record every state the store publishes — the machine's OBSERVABLE history,
 * which is what atomicity is a claim about. */
function recordStates(): { seen: OpenNoteState[]; stop: () => void } {
  const seen: OpenNoteState[] = [];
  const stop = useOpenNote.subscribe((s) => {
    seen.push(s);
  });
  return { seen, stop };
}

/** One macrotask hop — queueMicrotask callbacks all drain before it, without
 * the test having to guess how many promise ticks the machine takes. */
const drain = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The atomicity invariant, checked against every observed state: whenever a
 * file is loaded, the gate verdict on display was computed for THAT file. A
 * snapshot pairing one file's bytes with another file's verdict is exactly the
 * torn state the single-apply path-change branch exists to prevent.
 */
function expectGateInLockstep(seen: readonly OpenNoteState[]): void {
  for (const s of seen) {
    if (s.editor.path === null) continue;
    expect(s.analyzed.path).toBe(s.editor.path);
  }
}

/** Every state in which the given file was shown through the rich editor. */
function richSnapshotsFor(seen: readonly OpenNoteState[], path: string): OpenNoteState[] {
  return seen.filter(
    (s) =>
      s.openDoc.kind === "markdown" && s.openDoc.path === path && s.openDoc.surface.mode === "rich",
  );
}

describe("open-note-store publishEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Draining first always leaves the module-level pending target null: a
    // superseded pass is a no-op and the superseding one clears it, so no
    // deferred analysis can bleed into the next test.
    await drain();
    useOpenNote.setState(useOpenNote.getInitialState(), true);
  });

  it("gates a Raw-only file on the real markdown pipeline", () => {
    // Pins the fixtures the rest of the file leans on: if `<div>` ever enters
    // the vocabulary, these tests should fail HERE and not mysteriously below.
    openNote(RICH_PATH, RICH_MD);
    expect(useOpenNote.getState().analyzed.rawReason).toBeNull();

    useOpenNote.setState(useOpenNote.getInitialState(), true);
    openNote(OTHER_PATH, GATED_MD);
    expect(useOpenNote.getState().analyzed.rawReason).toEqual({ kind: "unknown-jsx", name: "div" });
  });

  describe("path change", () => {
    it("lands verdict + editor + mode in ONE update — a Raw-only file is never shown rich", () => {
      // Start on a rich file so the state being replaced is the dangerous one:
      // rawReason null and mode "rich" carried over would render Plate against
      // the next file's unparseable bytes.
      openNote(RICH_PATH, RICH_MD);
      expect(useOpenNote.getState().mode).toBe("rich");

      const { seen, stop } = recordStates();
      // Switch files exactly as the provider does (dispose → fresh runtime →
      // intent path → read resolves).
      const controller = mountRuntime();
      publishOpenPath(OTHER_PATH);
      const beforeLoad = seen.length;
      controller.emit({ path: OTHER_PATH, content: GATED_MD, dirty: false });
      stop();

      // The load is ONE store update: verdict, bytes and mode arrive together,
      // so there is no frame in which a subscriber could read a stale pairing.
      expect(seen.length - beforeLoad).toBe(1);

      const landed = seen[seen.length - 1];
      expect(landed).toBeDefined();
      expect(landed?.editor.content).toBe(GATED_MD);
      expect(landed?.analyzed).toEqual({
        rawReason: { kind: "unknown-jsx", name: "div" },
        content: GATED_MD,
        path: OTHER_PATH,
      });
      expect(landed?.mode).toBe("raw");
      expect(landed?.openDoc).toEqual({
        kind: "markdown",
        path: OTHER_PATH,
        isPrivate: false,
        surface: { mode: "raw", reason: { kind: "unknown-jsx", name: "div" } },
      });

      // The whole observable history, not just the endpoint.
      expectGateInLockstep(seen);
      expect(richSnapshotsFor(seen, OTHER_PATH)).toEqual([]);
    });

    it("an in-place path swap never shows the new file through the old file's verdict", () => {
      // The sharp version of the same property: no intervening empty state to
      // launder the carried-over "rich + no reason" pair, so a two-step apply
      // would put Plate on top of unparseable bytes for one observable frame.
      const controller = openNote(RICH_PATH, RICH_MD);
      expect(useOpenNote.getState().mode).toBe("rich");

      const { seen, stop } = recordStates();
      publishOpenPath(OTHER_PATH);
      controller.emit({ path: OTHER_PATH, content: GATED_MD, dirty: false });
      stop();

      expect(richSnapshotsFor(seen, OTHER_PATH)).toEqual([]);
      expectGateInLockstep(seen);
      expect(useOpenNote.getState().mode).toBe("raw");
    });

    it("keeps the user's Raw pick across a post-save flush and an external reload", () => {
      // The mode is picked once per OPEN. A dirty→clean flush and an
      // agent/external reload of the same file both re-publish the same path;
      // neither may yank the user back to Rich.
      const controller = openNote(RICH_PATH, RICH_MD);
      setOpenNoteMode("raw");

      controller.emit({ content: RICH_MD_2, dirty: true });
      controller.emit({ dirty: false });
      expect(useOpenNote.getState().mode).toBe("raw");

      controller.emit({ content: RICH_MD, dirty: false }); // external reload
      expect(useOpenNote.getState().mode).toBe("raw");
    });
  });

  describe("deferred same-path analysis", () => {
    it("defers to a microtask rather than blocking the settle", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.emit({ content: GATED_MD, dirty: true }); // typing
      controller.emit({ dirty: false }); // autosave settle

      // Synchronously after the settle the verdict still describes the PRIOR
      // saved bytes — the accepted one-frame window (the note is already on
      // screen with that verdict, and analyzeMarkdown is far too heavy to run
      // on the autosave commit path).
      expect(useOpenNote.getState().analyzed.content).toBe(RICH_MD);
      expect(useOpenNote.getState().analyzed.rawReason).toBeNull();

      await drain();
      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: { kind: "unknown-jsx", name: "div" },
        content: GATED_MD,
        path: RICH_PATH,
      });
    });

    it("drops a pass superseded by newer content on the same path", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      const { seen, stop } = recordStates();

      // Settle on unparseable bytes, then settle again on clean bytes before
      // the microtask runs — the first pass must never apply.
      controller.emit({ content: GATED_MD, dirty: false });
      controller.emit({ content: RICH_MD_2, dirty: false });
      await drain();
      stop();

      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: null,
        content: RICH_MD_2,
        path: RICH_PATH,
      });
      // The superseded verdict never became observable, so the note never
      // flickered into the textarea.
      expect(seen.some((s) => s.analyzed.content === GATED_MD)).toBe(false);
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expectGateInLockstep(seen);
    });

    it("collapses a burst of settles into exactly ONE analysis apply", async () => {
      // Each settle queues its own microtask, so N settles queue N passes. The
      // contract the deferral exists to buy — "one analysis pass per SAVED
      // content change" — only holds if the superseded passes drop themselves
      // instead of re-deriving a verdict that is already correct. Observable
      // as store updates: a redundant pass is a redundant re-render of every
      // editor consumer, on the heaviest function in the editor.
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.emit({ content: GATED_MD, dirty: false });
      controller.emit({ content: RICH_MD_2, dirty: false });
      controller.emit({ content: GATED_MD, dirty: false }); // back to the first bytes

      const { seen, stop } = recordStates();
      await drain();
      stop();

      expect(seen.length).toBe(1);
      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: { kind: "unknown-jsx", name: "div" },
        content: GATED_MD,
        path: RICH_PATH,
      });
    });

    it("drops a pass cancelled by a path change", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.emit({ content: GATED_MD, dirty: false }); // schedules a pass
      // The user switches files before the microtask runs. The in-flight pass
      // belongs to the file that is no longer open; applying it would stamp
      // a.md's verdict onto b.md.
      const next = mountRuntime();
      publishOpenPath(OTHER_PATH);
      next.emit({ path: OTHER_PATH, content: RICH_MD, dirty: false });
      await drain();

      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: null,
        content: RICH_MD,
        path: OTHER_PATH,
      });
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: OTHER_PATH,
        isPrivate: false,
        surface: { mode: "rich" },
      });
    });

    it("drops a pass whose buffer went dirty again, and re-runs on the next settle", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);

      controller.emit({ content: GATED_MD, dirty: false }); // schedules a pass
      // The buffer is re-dirtied at the SAME bytes before the microtask runs
      // (a paste-then-undo, or a transient settle re-emitting the buffer):
      // path and content still match the target, so `dirty` is the only thing
      // keeping the pass from stamping a verdict on an unsaved buffer.
      controller.emit({ dirty: true });
      await drain();

      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: null,
        content: RICH_MD,
        path: RICH_PATH,
      });

      // Dropped, not lost: the next clean settle analyzes the same bytes.
      controller.emit({ dirty: false });
      await drain();
      expect(useOpenNote.getState().analyzed).toEqual({
        rawReason: { kind: "unknown-jsx", name: "div" },
        content: GATED_MD,
        path: RICH_PATH,
      });
    });
  });

  describe("Rich→Raw flip toast", () => {
    it("fires once when a mid-session settle yanks Plate out from under the user", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      expect(useOpenNote.getState().mode).toBe("rich");

      controller.emit({ content: GATED_MD, dirty: false });
      await drain();

      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
        `Switched to Raw editing — ${describeGateReason({ kind: "unknown-jsx", name: "div" })}`,
      );
      // The pick is retained (a recovering file pops back to Rich) — only the
      // EFFECTIVE surface flipped.
      expect(useOpenNote.getState().mode).toBe("rich");
      expect(useOpenNote.getState().openDoc).toEqual({
        kind: "markdown",
        path: RICH_PATH,
        isPrivate: false,
        surface: { mode: "raw", reason: { kind: "unknown-jsx", name: "div" } },
      });
    });

    it("stays silent on a fresh open of a Raw-only file — the badge covers that", async () => {
      openNote(OTHER_PATH, GATED_MD);
      await drain();

      expect(useOpenNote.getState().analyzed.rawReason).toEqual({
        kind: "unknown-jsx",
        name: "div",
      });
      expect(useOpenNote.getState().mode).toBe("raw");
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });

    it("stays silent when the user is already in Raw — nothing visibly moved", async () => {
      const controller = openNote(RICH_PATH, RICH_MD);
      setOpenNoteMode("raw"); // header toggle

      controller.emit({ content: GATED_MD, dirty: false });
      await drain();

      expect(useOpenNote.getState().analyzed.rawReason).toEqual({
        kind: "unknown-jsx",
        name: "div",
      });
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });
});
