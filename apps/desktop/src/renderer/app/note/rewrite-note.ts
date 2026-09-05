// The renderer's twin of the server's writeIfUnchanged: read, apply a pure edit, write with the
// hash of the bytes that were read. A mismatch is REPORTED, never diff3-merged (which is what
// guarded-vault-io does for the open buffer): the caller named exact bytes, and a merge would be
// a guess about a note that moved.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

export interface RewriteNoteApi {
  vault: Pick<(typeof client)["vault"], "read" | "write">;
}

// null from the edit means "nothing to write" — the bytes no longer hold what the edit expected;
// an edit that answers the same bytes is `unchanged`, and still carries what it found
export type RewriteNoteOutcome<TWritten> =
  | { kind: "written"; result: TWritten }
  | { kind: "unchanged"; result: TWritten }
  // the note moved under the read; nothing was written
  | { kind: "changed" }
  | { kind: "failed"; message: string };

export async function rewriteNote<TWritten>(
  api: RewriteNoteApi,
  path: string,
  edit: (content: string) => { content: string; result: TWritten } | null,
): Promise<RewriteNoteOutcome<TWritten>> {
  const read = await safe(api.vault.read({ path }));
  if (read.error !== null) {
    return { kind: "failed", message: refusalMessage(read.error, "could not read it") };
  }
  const content = read.data.content;
  const edited = edit(content);
  if (edited === null) return { kind: "changed" };
  if (edited.content === content) return { kind: "unchanged", result: edited.result };
  const expectedHash = await contentHashHex(content);
  const { error } = await safe(api.vault.write({ path, content: edited.content, expectedHash }));
  if (error === null) return { kind: "written", result: edited.result };
  if (isDefinedError(error) && error.code === "CAS_MISMATCH") return { kind: "changed" };
  return { kind: "failed", message: refusalMessage(error, "the write was refused") };
}
