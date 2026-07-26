// Deep-link capture apply — the renderer half of the no-clobber design. The
// load-bearing invariant (the workstream's central one): a capture arriving
// while the user is TYPING in today's note must survive alongside the typing.
// The applier inserts through the live Plate editor (so the capture becomes
// part of the document the serialize → autosave pipeline persists) and only
// acks "applied" after a confirmed flush.

import { describe, expect, it } from "vitest";
import { NodeApi, createSlateEditor } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import {
  createCaptureApplier,
  insertCaptureLine,
  type CaptureAckOutcome,
  type CaptureApplyPorts,
} from "@renderer/workspace/capture-apply";

const PATH = "journal/2026-07-16.md";

function seedEditor(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
}

type Editor = ReturnType<typeof seedEditor>;

function serialize(editor: Editor): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

/** Simulate the user typing at the end of the paragraph containing `marker`. */
function typeInto(editor: Editor, marker: string, text: string): void {
  const index = editor.children.findIndex((node) => NodeApi.string(node).includes(marker));
  expect(index).toBeGreaterThanOrEqual(0);
  const end = editor.api.end([index]);
  expect(end).toBeDefined();
  if (end) editor.tf.insertText(text, { at: end });
}

type HarnessOptions = {
  editor?: Editor | null;
  openPath?: string | null;
  transients?: () => boolean;
  /** Runs inside flush, BEFORE the buffer is captured — the keystroke race. */
  onFlush?: () => void;
  flushResult?: boolean;
};

function harness(opts: HarnessOptions = {}) {
  const editor = opts.editor === undefined ? seedEditor("Existing note.\n") : opts.editor;
  const acks: Array<{ id: string; outcome: CaptureAckOutcome }> = [];
  let buffer = editor === null ? "raw buffer\n" : serialize(editor);
  let persisted: string | null = null;
  let appliedToasts = 0;
  const editBufferCalls: string[] = [];
  const ports: CaptureApplyPorts = {
    openPath: () => (opts.openPath === undefined ? PATH : opts.openPath),
    liveEditor: () => editor,
    hasTransients: () => opts.transients?.() ?? false,
    insertLine: insertCaptureLine,
    bufferContent: () => buffer,
    editBuffer: (_path, content) => {
      editBufferCalls.push(content);
      buffer = content;
    },
    flush: async () => {
      opts.onFlush?.();
      // The runtime flush drains the serialize debounce: the live editor's
      // CURRENT document becomes the buffer, then persists.
      if (editor !== null) buffer = serialize(editor);
      persisted = buffer;
      return opts.flushResult ?? true;
    },
    ack: (id, outcome) => acks.push({ id, outcome }),
    onApplied: () => {
      appliedToasts++;
    },
    retryDelayMs: 1,
  };
  const applier = createCaptureApplier(ports);
  return {
    applier,
    editor,
    acks,
    editBufferCalls,
    getPersisted: () => persisted,
    getBuffer: () => buffer,
    toasts: () => appliedToasts,
  };
}

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `predicate` until it holds — waits exactly as long as the async chain
 * needs instead of guessing a fixed duration. Used where the result arrives
 * after a real-timer poll (the deferred-capture retry), which a fixed `settle`
 * races under a loaded CI scheduler. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition never held");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("rich-mode apply", () => {
  it("inserts through the live editor and acks applied only after flush", async () => {
    const h = harness();
    h.applier.apply({ id: "c1", path: PATH, line: "- captured" });
    await settle();
    expect(h.getPersisted()).toBe("Existing note.\n\n- captured\n");
    expect(h.acks).toEqual([{ id: "c1", outcome: "applied" }]);
    expect(h.toasts()).toBe(1);
    // The clobber vector — routing through the value prop — must stay unused.
    expect(h.editBufferCalls).toEqual([]);
  });

  it("a keystroke racing the flush survives alongside the capture", async () => {
    const h = harness({
      onFlush: () => {
        // The user types between the insert and the flush's serialize.
        if (h.editor) typeInto(h.editor, "Existing note", " Typed mid-capture.");
      },
    });
    h.applier.apply({ id: "c2", path: PATH, line: "- captured" });
    await settle();
    const persisted = h.getPersisted();
    expect(persisted).toContain("Existing note. Typed mid-capture.");
    expect(persisted).toContain("- captured");
    expect(h.acks).toEqual([{ id: "c2", outcome: "applied" }]);
  });

  it("task lines land as unchecked checkboxes", async () => {
    const h = harness();
    h.applier.apply({ id: "c3", path: PATH, line: "- [ ] buy milk" });
    await settle();
    expect(h.getPersisted()).toBe("Existing note.\n\n- [ ] buy milk\n");
  });

  it("does not double-insert a line already in the buffer", async () => {
    const editor = seedEditor("Existing note.\n\n- captured\n");
    const h = harness({ editor });
    h.applier.apply({ id: "c4", path: PATH, line: "- captured" });
    await settle();
    expect(h.getPersisted()).toBe("Existing note.\n\n- captured\n");
    expect(h.acks).toEqual([{ id: "c4", outcome: "applied" }]);
  });

  it("duplicate deliveries of the same id are ignored", async () => {
    const h = harness();
    h.applier.apply({ id: "c5", path: PATH, line: "- captured" });
    h.applier.apply({ id: "c5", path: PATH, line: "- captured" });
    await settle();
    expect(h.getPersisted()).toBe("Existing note.\n\n- captured\n");
    expect(h.acks).toEqual([{ id: "c5", outcome: "applied" }]);
  });
});

describe("transient AI session gating", () => {
  it("defers while transients pend, applies after they settle", async () => {
    let pending = true;
    const h = harness({ transients: () => pending });
    h.applier.apply({ id: "c6", path: PATH, line: "- captured" });
    await settle(5);
    // Parked: deferred ack sent, nothing inserted, nothing flushed.
    expect(h.acks).toEqual([{ id: "c6", outcome: "deferred" }]);
    expect(h.getPersisted()).toBeNull();
    pending = false;
    // The re-apply lands on the next retry poll; wait for the applied ack
    // rather than a fixed sleep (persisted is written before that ack).
    await waitFor(() => h.acks.length === 2);
    expect(h.acks).toEqual([
      { id: "c6", outcome: "deferred" },
      { id: "c6", outcome: "applied" },
    ]);
    expect(h.getPersisted()).toBe("Existing note.\n\n- captured\n");
  });

  it("a note switch while deferred hands the capture back to the host", async () => {
    const pending = true;
    let open: string | null = PATH;
    const editor = seedEditor("Existing note.\n");
    const acks: Array<{ id: string; outcome: CaptureAckOutcome }> = [];
    const applier = createCaptureApplier({
      openPath: () => open,
      liveEditor: () => editor,
      hasTransients: () => pending,
      insertLine: insertCaptureLine,
      bufferContent: () => serialize(editor),
      editBuffer: () => {},
      flush: async () => true,
      ack: (id, outcome) => acks.push({ id, outcome }),
      onApplied: () => {},
      retryDelayMs: 1,
    });
    applier.apply({ id: "c7", path: PATH, line: "- captured" });
    await settle(5);
    expect(acks).toEqual([{ id: "c7", outcome: "deferred" }]);
    open = "other/note.md"; // the user navigated away mid-session
    // The not-open verdict lands on the next retry poll — wait for it.
    await waitFor(() => acks.length === 2);
    expect(acks).toEqual([
      { id: "c7", outcome: "deferred" },
      { id: "c7", outcome: "not-open" },
    ]);
  });
});

describe("raw-mode and not-open paths", () => {
  it("falls back to a buffer edit when no live editor is mounted", async () => {
    const h = harness({ editor: null });
    h.applier.apply({ id: "c8", path: PATH, line: "- captured" });
    await settle();
    expect(h.editBufferCalls).toEqual(["raw buffer\n- captured\n"]);
    expect(h.getPersisted()).toBe("raw buffer\n- captured\n");
    expect(h.acks).toEqual([{ id: "c8", outcome: "applied" }]);
  });

  it("acks not-open when the target is not the open note", async () => {
    const h = harness({ openPath: "other/note.md" });
    h.applier.apply({ id: "c9", path: PATH, line: "- captured" });
    await settle();
    expect(h.acks).toEqual([{ id: "c9", outcome: "not-open" }]);
    expect(h.getPersisted()).toBeNull();
  });

  it("acks not-open when the flush fails, leaving the host drain as backup", async () => {
    const h = harness({ flushResult: false });
    h.applier.apply({ id: "c10", path: PATH, line: "- captured" });
    await settle();
    expect(h.acks).toEqual([{ id: "c10", outcome: "not-open" }]);
    expect(h.toasts()).toBe(0);
  });

  it("dispose stops a deferred retry loop", async () => {
    const h = harness({ transients: () => true });
    h.applier.apply({ id: "c11", path: PATH, line: "- captured" });
    await settle(5);
    h.applier.dispose();
    const before = h.acks.length;
    await settle(20);
    expect(h.acks.length).toBe(before);
  });
});
