// The session's note port over the typed client, framework-free so the WRITE
// POLICY unit-tests against the real vault: what each verb sends, and what a
// refusal does.
//
// THE WRITE IS GUARDED HERE. The controller's `write` carries no base, so this
// port remembers the last content it READ (or created) per path and writes
// with that base's hash; a CAS refusal carries the disk's truth, which is
// three-way merged (diff3, buffer preferred on overlap) and retried ONCE
// against the disk content's own hash. The buffer converges through the
// runtime's normal reload on the write's own files-changed broadcast — the
// user's bytes are in the merged write either way, so nothing is ever
// silently clobbered.
//
// A CREATE IS NOT A WRITE WITH AN EMPTY BASE. A path with no bytes on disk has
// no base to name; hashing the content about to be written names bytes that
// are not there, which the server can only refuse. So `create` sends
// `ifAbsent` and no hash — and where the path already holds a file it is
// refused rather than merged, because the caller asked for a new note, not a
// union with whatever is there.

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";
import type { VaultNoteIO } from "@repo/editor/note/vault-session";
import { isNotePath } from "@repo/notes/knowledge/doc-file";
import { isTrashedPath } from "@repo/notes/knowledge/vault-path";
import { diff3 } from "@repo/notes/text/diff3";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

/** The four procedures this port reaches, structurally — so a caller (and a
 *  test) hands over what it uses rather than the whole client. */
export interface GuardedVaultApi {
  vault: Pick<(typeof client)["vault"], "read" | "write" | "trash" | "remove">;
}

export function createGuardedVaultIo(api: GuardedVaultApi): VaultNoteIO {
  // Base bytes per path, recorded at every read and create; what a guarded
  // write's expectedHash is computed FROM.
  const bases = new Map<string, string>();

  const read = async (path: string): Promise<string> => {
    const { content } = await api.vault.read({ path });
    bases.set(path, content);
    return content;
  };

  const create = async (path: string, content: string): Promise<void> => {
    await api.vault.write({ path, content, ifAbsent: true });
    bases.set(path, content);
  };

  const write = async (path: string, content: string): Promise<void> => {
    const base = bases.get(path);
    // Without a base the guard has nothing honest to say: a hash of the
    // content about to be written would make a concurrent edit merge to the
    // disk's bytes alone, dropping this one silently. Every open reads first,
    // so reaching here is a caller bug, and it should be loud.
    if (base === undefined) {
      throw new Error(`write ${path}: no base was read, so nothing can guard this write`);
    }
    const expectedHash = await contentHashHex(base);
    const { error } = await safe(api.vault.write({ path, content, expectedHash }));
    if (error === null) {
      bases.set(path, content);
      return;
    }
    // A CAS refusal with no `current` is a delete that raced the write: there
    // is nothing on disk to merge against, so it refuses like any other.
    if (
      isDefinedError(error) &&
      error.code === "CAS_MISMATCH" &&
      error.data.current !== undefined
    ) {
      const disk = error.data.current.content;
      const { merged } = diff3(base, content, disk);
      const retryHash = await contentHashHex(disk);
      const retry = await safe(api.vault.write({ path, content: merged, expectedHash: retryHash }));
      if (retry.error === null) {
        bases.set(path, merged);
        return;
      }
      throw new Error(
        `write ${path}: conflict retry refused (${refusalMessage(retry.error, "no reason given")})`,
      );
    }
    throw error;
  };

  const remove = async (path: string): Promise<DeleteVaultEntryResult> => {
    // A note deletes into the vault's Trash/ (restorable for 30 days);
    // anything else, and anything already in the trash, deletes for real.
    // The port answers "trashed" either way: the session only needs to know
    // the row is gone from the listing.
    const isNote = isNotePath(path);
    const inTrash = isTrashedPath(path);
    const { error } =
      isNote && !inTrash
        ? await safe(api.vault.trash({ path }))
        : await safe(api.vault.remove({ path }));
    if (error === null) return { outcome: "trashed" };
    if (isDefinedError(error) && error.code === "NOT_FOUND") return { outcome: "absent" };
    throw error;
  };

  return { read, write, create, remove };
}
