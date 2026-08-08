// Applies a deep-link capture line to the OPEN note through the live editor
// machinery — the client half of the no-clobber design. A host write
// to an open DIRTY note would be skipped by reloadOpen (vault-editor's
// dirty-skip) and then overwritten by the next whole-buffer autosave flush,
// losing the capture; routing the line INTO the live buffer makes it part of
// what the autosave itself persists.
//
// Two apply paths, per the editor machinery that actually persists bytes:
//   Rich mounted → a Plate transform through getLiveEditor (the frontmatter
//     properties panel's seam), so the normal serialize → onChange →
//     runtime.edit pipeline carries it — inserting via runtime.edit here
//     would trip markdown-editor's value-prop re-seed effect, whose
//     scheduler.flush() serializes the line-less Plate doc back over the
//     appended content under concurrent typing.
//   Raw mode / no live editor → runtime.edit (via the provider's editNote),
//     which arms the autosave debounce.
// Either way the ack is sent only AFTER a confirmed flush, so a renderer
// crash inside the debounce can't lose an already-deleted inbox entry.
//
// A pending transient AI session (stream or suggestions) freezes the buffer
// and a value re-seed would destroy the session plus interleaved typing — so
// the applier acks "deferred" (parking the durable entry host-side, timeout
// drain canceled) and re-checks until the session settles.

import type { SlateEditor } from "platejs";

import { appendCaptureLine, hasExactCaptureLine } from "@repo/bridge/deep-link";
import type { CaptureAckOutcome, CaptureApplyEvent } from "@repo/bridge/deep-link";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";

// Re-exported beside the ports type that carries it, so applier consumers
// (and its tests) need only this module.
export type { CaptureAckOutcome };

export type CaptureApplyPorts = {
  /** The open note's vault-relative path right now, or null. */
  openPath: () => string | null;
  /** The mounted rich editor serving `path`, or null (Raw mode / none). */
  liveEditor: (path: string) => SlateEditor | null;
  /** Whether the editor holds transient AI state (stream / suggestions). */
  hasTransients: (editor: SlateEditor) => boolean;
  /** Insert the capture line into the live editor as a trailing block. */
  insertLine: (editor: SlateEditor, line: string) => void;
  /** The open note's current buffer, or null when none is loaded. */
  bufferContent: () => string | null;
  /** Record a buffer edit on the open note (routes through runtime.edit). */
  editBuffer: (path: string, content: string) => void;
  /** Persist the open note now; resolves true when the buffer is clean. */
  flush: () => Promise<boolean>;
  ack: (id: string, outcome: CaptureAckOutcome) => void;
  /** A capture landed (toast). */
  onApplied: () => void;
  /** Re-check cadence while a transient AI session blocks the apply. */
  retryDelayMs?: number;
};

export type CaptureApplier = {
  /** Handle one onCaptureApply event (idempotent per id). */
  apply: (payload: CaptureApplyEvent) => void;
  /** Stop retrying (provider unmount). */
  dispose: () => void;
};

/** Insert `line` (already-formatted markdown, e.g. `- [ ] text`) at the end
 * of a live Plate editor via the owned parse pipeline, so the node shape is
 * exactly what the serializer round-trips. */
export function insertCaptureLine(editor: SlateEditor, line: string): void {
  const parsed = parseMarkdown(line);
  // Sanitized capture text always parses; the fallback keeps the surface
  // alive if the vocabulary ever narrows underneath us.
  const nodes = parsed.ok ? parsed.value : [{ children: [{ text: line }], type: "p" }];
  editor.tf.insertNodes(nodes, { at: [editor.children.length] });
}

export function createCaptureApplier(ports: CaptureApplyPorts): CaptureApplier {
  const handled = new Set<string>();
  let disposed = false;
  const retryDelayMs = ports.retryDelayMs ?? 500;

  async function applyInner(payload: CaptureApplyEvent, deferredAcked: boolean): Promise<void> {
    if (disposed) return;
    if (ports.openPath() !== payload.path) {
      // Not (or no longer) the open note — the host drains it to disk.
      ports.ack(payload.id, "not-open");
      return;
    }
    const editor = ports.liveEditor(payload.path);
    if (editor !== null && ports.hasTransients(editor)) {
      if (!deferredAcked) ports.ack(payload.id, "deferred");
      setTimeout(() => {
        void applyInner(payload, true);
      }, retryDelayMs);
      return;
    }
    const content = ports.bufferContent();
    if (content === null) {
      ports.ack(payload.id, "not-open");
      return;
    }
    // Belt-and-braces idempotency: a line already in the buffer (a drain that
    // reloaded into a clean editor, a duplicate delivery) is not re-inserted.
    if (!hasExactCaptureLine(content, payload.line)) {
      if (editor !== null) {
        ports.insertLine(editor, payload.line);
        // Slate batches its onChange into a microtask; yield one macrotask so
        // the serialize debounce is armed before flush() drains it — the
        // flush's pre-flush hook serializes the inserted line into the buffer.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        ports.editBuffer(payload.path, appendCaptureLine(content, payload.line));
      }
    }
    const clean = await ports.flush().catch(() => false);
    if (clean) {
      ports.ack(payload.id, "applied");
      ports.onApplied();
    } else {
      // The flush failed — the line still sits in the (dirty) buffer, and the
      // host's disk drain becomes the second persistence path; exact-line
      // dedupe keeps the eventual autosave + the drain from doubling it.
      ports.ack(payload.id, "not-open");
    }
  }

  return {
    apply: (payload: CaptureApplyEvent): void => {
      if (handled.has(payload.id)) return;
      handled.add(payload.id);
      void applyInner(payload, false);
    },
    dispose: (): void => {
      disposed = true;
    },
  };
}
