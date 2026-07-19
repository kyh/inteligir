// ---------------------------------------------------------------------------
// The metadata remap that must follow ANY note rename — the single authority
// shared by the user-facing `renameVaultEntry` handler and the agent's
// `rename_note` tool, so the two rename paths can never drift.
//
// A rename preserves content, so delegation positional anchors and AI-edit
// restore targets stay valid — they just need repointing at the new path.
// This is BEST-EFFORT on top of the disk rename (the source of truth): if a
// manager throws, we log and move on rather than fail a rename that already
// happened and leave the two views inconsistent.
// ---------------------------------------------------------------------------

import { getDelegationManager } from "../delegation/delegation-manager";
import { getRestoreManager } from "../restore/restore-manager";

/** Repoint delegations and AI-edit snapshots from `from` to `to` after a
 * successful note rename. Best-effort; never throws. */
export function remapNoteMetadata(from: string, to: string): void {
  try {
    // Delegations: badges keep matching and queued runs target the new path.
    getDelegationManager().renameSource(from, to);
    // AI-edit snapshots: a chat capture's entry path is its restore
    // target, so undo must follow the moved file.
    getRestoreManager().renamePath(from, to);
  } catch (err) {
    console.warn("[vault] delegation/snapshot remap after rename failed:", err);
  }
}
