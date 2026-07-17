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

import type { AppAgentEvent } from "@repo/features/agent-events";
import type { AgentEditCaptured } from "@repo/features/ipc-registry";

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
    const name = first.path.split("/").at(-1) ?? first.path;
    return first.kind === "create" ? `Agent created "${name}"` : `Agent edited "${name}"`;
  }
  return `Agent edited ${edits.length} notes`;
}
