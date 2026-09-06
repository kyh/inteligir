import type { ContractRouterClient } from "@orpc/contract";
import { commentsStorePath, isNoteIdKey } from "@repo/notes/comments/sidecar-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import type { LocalContract } from "../local-contract";

export type CommentStoreRestore = "restored" | "kept" | "none";

// The other half of a deleted-note restore, run by both clients after the note's own revision
// read and ifAbsent write: the store was removed with the note, so it comes back from the same
// revision the same way. "kept": a store already sits at that id (a note re-created there since),
// and it wins. "none": the note carries no id, or held no store at that revision.
export async function restoreCommentStore(
  api: Pick<ContractRouterClient<LocalContract>, "vault">,
  noteContent: string,
  sha: string,
): Promise<CommentStoreRestore> {
  const id = frontmatterId(noteContent);
  if (id === null || !isNoteIdKey(id)) return "none";
  const path = commentsStorePath(id);
  let content: string;
  try {
    ({ content } = await api.vault.revision({ path, sha }));
  } catch {
    return "none";
  }
  try {
    await api.vault.write({ path, content, ifAbsent: true });
  } catch {
    return "kept";
  }
  return "restored";
}
