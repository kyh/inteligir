import { isDefinedError, safe } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { commentsStorePath, isNoteIdKey } from "@repo/notes/comments/sidecar-schema";
import { mintNoteId, reassignFrontmatterId } from "@repo/notes/markdown/frontmatter";

import type { LocalContract } from "../local-contract";
import { contentHashHex } from "./vault-schema";

// "changed": the note no longer carries the id it was named with, or it moved under the write;
// either way it is as it was. "invalid": its frontmatter is not YAML anything may rewrite.
// "failed": any other refusal, and the note still shares the id.
export type NoteOwnId =
  | { kind: "done"; id: string; comments: "copied" | "none" }
  | { kind: "changed" }
  | { kind: "invalid" }
  | { kind: "failed"; error: Error };

type VaultClient = ContractRouterClient<LocalContract>["vault"];

interface OwnIdApi {
  vault: Pick<VaultClient, "read" | "remove" | "write">;
}

type StoreCopy = { kind: "copied" } | { kind: "none" } | { kind: "failed"; error: Error };

// verbatim: the store is keyed by comment id and names no note, so its bytes serve either one.
const copyCommentStore = async (api: OwnIdApi, from: string, to: string): Promise<StoreCopy> => {
  if (!isNoteIdKey(from)) {
    return { kind: "none" };
  }
  const read = await safe(api.vault.read({ path: commentsStorePath(from) }));
  if (read.error !== null) {
    return isDefinedError(read.error) && read.error.code === "NOT_FOUND"
      ? { kind: "none" }
      : { error: read.error, kind: "failed" };
  }
  const written = await safe(
    api.vault.write({
      content: read.data.content,
      guard: { kind: "absent" },
      path: commentsStorePath(to),
    }),
  );
  return written.error === null ? { kind: "copied" } : { error: written.error, kind: "failed" };
};

// A copy made outside the app (Finder's duplicate, `cp`) carries its original's `id:`, so the two
// share one comment store and one `[[Title|uuid]]` identity. Run by both clients on the copy the
// user or the agent names: it takes a new id and a copy of the store, so both notes keep every
// thread and diverge from here, and the note keeping `from` keeps the links and actions made with
// it. Deleting the `id:` line instead strands the copy's anchors, whose bodies live in the store.
// The store lands before the note, because a note whose anchors have no bodies strands its
// threads where a store no note carries is only left over; a refused note write takes it back.
export const giveNoteOwnId = async (
  api: OwnIdApi,
  path: string,
  from: string,
): Promise<NoteOwnId> => {
  const note = await safe(api.vault.read({ path }));
  if (note.error !== null) {
    return { error: note.error, kind: "failed" };
  }
  const id = mintNoteId();
  const reassigned = reassignFrontmatterId(note.data.content, from, id);
  if (reassigned.kind !== "written") {
    return reassigned;
  }
  const store = await copyCommentStore(api, from, id);
  if (store.kind === "failed") {
    return store;
  }
  const written = await safe(
    api.vault.write({
      content: reassigned.content,
      guard: { hash: await contentHashHex(note.data.content), kind: "expected" },
      path,
    }),
  );
  if (written.error !== null) {
    if (store.kind === "copied") {
      await safe(api.vault.remove({ path: commentsStorePath(id) }));
    }
    return isDefinedError(written.error) && written.error.code === "CAS_MISMATCH"
      ? { kind: "changed" }
      : { error: written.error, kind: "failed" };
  }
  return { comments: store.kind, id, kind: "done" };
};
