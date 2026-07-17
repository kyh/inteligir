import { getCheckpointManager } from "../checkpoints/checkpoint-manager";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerCheckpointHandlers(handle: HandlerRegistrar): void {
  // Undo a turn's chat-agent edits. No busy-guard, deliberately: the undo
  // toast appears after the turn that produced these checkpoints has settled,
  // and the restore is an ordinary user-intent vault write — if a LATER turn
  // is concurrently editing the same file, that turn's own writes are being
  // checkpointed too, so nothing becomes unrecoverable (last-write-wins, same
  // as any user edit racing an agent). Contrast delegation restore, which
  // must refuse while ITS run is active because the run targets the same
  // snapshot. The renderer flushes the open note before calling (registry
  // contract), so the write never fights a dirty buffer.
  handle("restoreAgentEdits", ({ ids }) => getCheckpointManager().restore(ids));
}
