import { commentsStorePath, isNoteIdKey } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import { VaultServiceError, type VaultService } from "../vault/vault-service";

// A note's comment store goes with the note, a folder's with every note under it, so nothing
// leaks under `.inteligir/`; the deleted-notes restore brings both back from the same revision.
// The entry goes first: a store left behind is a leak, a store gone before its note is a loss.
// Two notes sharing one id would lose the survivor's comments here, the same ambiguity the
// `[[Title|uuid]]` tier already warns about.
export async function removeEntryWithComments(service: VaultService, path: string): Promise<void> {
  const kind = await service.statEntry(path);
  const docs =
    kind === "dir"
      ? (await service.listFilesUnder(path)).filter(isDocPath)
      : kind === "file" && isDocPath(path)
        ? [path]
        : [];
  const ids: string[] = [];
  for (const doc of docs) {
    const id = frontmatterId((await service.read(doc)).content);
    if (id !== null && isNoteIdKey(id)) ids.push(id);
  }
  await service.remove(path);
  for (const id of ids) {
    try {
      await service.remove(commentsStorePath(id));
    } catch (error) {
      if (!(error instanceof VaultServiceError && error.code === "not_found")) throw error;
    }
  }
}
