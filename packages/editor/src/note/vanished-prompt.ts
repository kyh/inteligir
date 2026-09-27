// What every host asks and says about the open note in the same words: the question a note deleted
// under unsaved edits asks, and the line a save that kept this device's lines over another's says.

import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { confirm } from "@repo/ui/components/confirm-dialog";

import type { VaultSessionPorts } from "@repo/editor/note/vault-session";

// discarding is the confirm, so an Escape or a dismissal re-creates and the edits survive it
export const confirmVanished: VaultSessionPorts["askVanished"] = async (path) =>
  (await confirm({
    body: "It was deleted while it had unsaved edits. Re-create it with them, or discard them.",
    cancelLabel: "Re-create",
    confirmLabel: "Discard edits",
    destructive: true,
    title: `${basenamePath(path)} was deleted`,
  }))
    ? "discard"
    : "recreate";

export const mergeConflictLine = (path: string): string =>
  `${path} also changed elsewhere. Where both changed the same lines, yours were kept.`;
