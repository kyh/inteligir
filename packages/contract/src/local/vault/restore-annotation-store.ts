import { isDefinedError, safe } from "@orpc/client";
import { annotationStoreKey } from "@repo/notes/annotations/annotation-key";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";

import type { LocalClient } from "../local-contract";

// "kept": a store already sits at that id (a note re-created there since), and it wins. "none":
// the note carries no id, or held no store at that revision. "failed": any other refusal, reported
// rather than folded into either, because the note is already back and a store that silently
// stayed behind strands its threads.
export type AnnotationStoreRestore =
  | { kind: "restored" }
  | { kind: "kept" }
  | { kind: "none" }
  | { kind: "failed"; error: Error };

type VaultClient = LocalClient["vault"];

// The other half of a deleted-note restore, run by both clients after the note's own revision
// read and `absent`-guarded write: the store was removed with the note, so it comes back from the
// same revision the same way.
export const restoreAnnotationStore = async (
  api: { vault: Pick<VaultClient, "revision" | "write"> },
  noteContent: string,
  sha: string,
): Promise<AnnotationStoreRestore> => {
  const id = annotationStoreKey(noteContent);
  if (id === null) {
    return { kind: "none" };
  }
  const path = annotationsStorePath(id);
  const read = await safe(api.vault.revision({ path, sha }));
  if (read.error !== null) {
    return isDefinedError(read.error) && read.error.code === "NOT_FOUND"
      ? { kind: "none" }
      : { error: read.error, kind: "failed" };
  }
  const written = await safe(
    api.vault.write({ content: read.data.content, guard: { kind: "absent" }, path }),
  );
  if (written.error !== null) {
    return isDefinedError(written.error) && written.error.code === "ALREADY_EXISTS"
      ? { kind: "kept" }
      : { error: written.error, kind: "failed" };
  }
  return { kind: "restored" };
};
