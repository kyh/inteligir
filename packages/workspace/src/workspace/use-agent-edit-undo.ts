// The post-turn agent-edit undo toast — the minimum honest undo for a chat-
// agent edit. A toast (not a dock card, not a history browser) because the
// user just asked for this work in the composer and is looking at the result:
// the affordance appears exactly when the "wait, no" reflex fires, costs no
// permanent chrome in the one-fixed-workspace UI, and decays with its own
// usefulness — once the user edits on top, restoring pre-turn bytes stops
// being what "undo" means. The checkpoints themselves outlive the toast
// (newest 50, host-side); a durable browsing surface over them
// is the deliberately-cut version-history feature, not this.
//
// Undo flow (Wave 5 flush-first pattern, same as the tasks-view toggle): the
// open note is flushed BEFORE the restore, so the host's disk write never
// fights a dirty buffer — a dirty editor would skip the external-change
// reload and its next autosave would clobber the restore. Post-flush the
// buffer is clean, so the open-note watcher reloads the restored bytes into
// the editor; non-open files just change on disk.

import { useEffect } from "react";

import { toast } from "@repo/ui/components/sonner";

import type { Bridge } from "@repo/bridge/ipc-registry";
import type { AgentEditCaptured } from "@repo/bridge/ipc-registry";
import { getBridge } from "@repo/bridge/client";
import {
  connectAgentEditUndo,
  describeAgentEdits,
  runAgentEditUndo,
} from "@repo/workspace/workspace/agent-edit-undo";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";

// Long enough to read the headline and reconsider; short enough that stale
// undo affordances don't pile up over the composer.
const UNDO_TOAST_DURATION_MS = 12_000;

async function undoAgentEdits(bridge: Bridge, edits: AgentEditCaptured[]): Promise<void> {
  const result = await runAgentEditUndo(edits, {
    flushOpenNote,
    restore: (ids) => bridge.restoreAgentEdits({ ids }),
  });
  if (result.ok) {
    toast.success(edits.length === 1 ? "Restored." : `Restored ${edits.length} notes.`);
  } else {
    toast.error(result.error);
  }
}

/** Mounted once inside the workspace: collects the host's checkpoint
 * announcements and offers one Undo toast per settled agent turn. */
export function useAgentEditUndo(): void {
  useEffect(() => {
    const bridge = getBridge();
    return connectAgentEditUndo({
      subscribeCaptured: bridge.onAgentEditCaptured,
      subscribeAgentEvents: bridge.onAgentEvent,
      present: (edits) => {
        toast(describeAgentEdits(edits), {
          duration: UNDO_TOAST_DURATION_MS,
          action: {
            label: "Undo",
            onClick: () => {
              void undoAgentEdits(bridge, edits);
            },
          },
        });
      },
    });
  }, []);
}
