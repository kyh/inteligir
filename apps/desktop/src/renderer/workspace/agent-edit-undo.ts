// The pure connection logic behind the post-turn agent-edit undo toast — the
// chat-agent counterpart of the delegation dock's "Restore original".
//
// The host checkpoints the pre-write bytes of every allowed chat-agent
// edit/write at the tool gate and announces each capture (onAgentEditCaptured)
// MID-turn. This module collects those announcements and, when the turn
// settles (agent_end), hands the per-file undo set to a presenter: the FIRST
// capture per path wins, because its bytes are the pre-turn state — later
// captures of the same file hold mid-turn intermediates, and an "undo the
// agent's edit" means back-to-before-the-turn, exactly like a delegation
// restore means back-to-before-the-run. A turn that captured a `create` first
// undoes to deletion even if later edits followed — the file didn't exist
// before the turn.
//
// Extracted from the hook (use-agent-edit-undo.ts) so the collection protocol
// is unit-testable with fakes, mirroring connectDeepLinkNav.

import { basenamePath } from "@repo/core/knowledge/vault-path";
import type { AppAgentEvent } from "@repo/features/agent-events";
import { toErrorMessage } from "@repo/features/ipc";
import type { AgentEditCaptured, RestoreAgentEditsResult } from "@repo/features/ipc-registry";

export type AgentEditUndoPorts = {
  /** Bridge onAgentEditCaptured. */
  subscribeCaptured: (listener: (event: AgentEditCaptured) => void) => () => void;
  /** Bridge onAgentEvent (only agent_end is consumed). */
  subscribeAgentEvents: (listener: (event: AppAgentEvent) => void) => () => void;
  /** Present the undo affordance for a settled turn's edits (first capture
   * per path, capture order). Never called with an empty list. */
  present: (edits: AgentEditCaptured[]) => void;
};

/** Wire the collector. Returns a disposer (provider unmount). */
export function connectAgentEditUndo(ports: AgentEditUndoPorts): () => void {
  // Keyed by path; the first capture of a path in a turn wins (see header).
  const pending = new Map<string, AgentEditCaptured>();
  const unsubCaptured = ports.subscribeCaptured((event) => {
    if (!pending.has(event.path)) pending.set(event.path, event);
  });
  const unsubAgent = ports.subscribeAgentEvents((event) => {
    if (event.type !== "agent_end" || pending.size === 0) return;
    const edits = [...pending.values()];
    pending.clear();
    ports.present(edits);
  });
  return () => {
    unsubCaptured();
    unsubAgent();
  };
}

/** The undo toast's headline. One file names it (created vs edited); several
 * files summarize — the toast is a transient affordance, not a report. */
export function describeAgentEdits(edits: AgentEditCaptured[]): string {
  const first = edits[0];
  if (edits.length === 1 && first) {
    const name = basenamePath(first.path);
    return first.kind === "create" ? `Agent created "${name}"` : `Agent edited "${name}"`;
  }
  return `Agent edited ${edits.length} notes`;
}

export type AgentEditUndoRunPorts = {
  /** Persist the open note now (open-note-flush). Its settled value is
   * irrelevant here — only the ORDERING is load-bearing. */
  flushOpenNote: () => Promise<boolean>;
  /** Bridge restoreAgentEdits. */
  restore: (ids: string[]) => Promise<RestoreAgentEditsResult>;
};

/** Execute an undo: flush the open note FIRST, then restore. Flush-first is
 * the open-note coherence contract (the tasks-view toggle pattern): the
 * restore lands on disk, and a dirty editor buffer would dirty-skip the
 * external-change reload and then autosave its stale contents OVER the
 * restore — flushing makes the buffer clean, so the open-note watcher
 * reloads the restored bytes into the editor. A FAILED flush still proceeds:
 * the restore is the user's explicit intent, disk is its target either way,
 * and the conflict machinery owns whatever the dirty buffer does next.
 * Rejections come back as error VALUES so the caller only renders. */
export async function runAgentEditUndo(
  edits: AgentEditCaptured[],
  ports: AgentEditUndoRunPorts,
): Promise<RestoreAgentEditsResult> {
  await ports.flushOpenNote();
  try {
    return await ports.restore(edits.map((edit) => edit.id));
  } catch (err) {
    return {
      ok: false,
      error: toErrorMessage(err, "Couldn't restore the notes."),
    };
  }
}
