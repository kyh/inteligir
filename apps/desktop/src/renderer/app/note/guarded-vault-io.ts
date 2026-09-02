import type { DeleteVaultEntryResult } from "@repo/editor/host-io";
import type { VaultNoteIO } from "@repo/editor/note/vault-session";
import { isNotePath } from "@repo/notes/knowledge/doc-file";
import { isTrashedPath } from "@repo/notes/knowledge/vault-path";
import { diff3 } from "@repo/notes/text/diff3";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

export interface GuardedVaultApi {
  vault: Pick<(typeof client)["vault"], "read" | "write" | "trash" | "remove">;
}

export function createGuardedVaultIo(api: GuardedVaultApi): VaultNoteIO {
  const bases = new Map<string, string>();

  const read = async (path: string): Promise<string> => {
    const { content } = await api.vault.read({ path });
    bases.set(path, content);
    return content;
  };

  const create = async (path: string, content: string): Promise<void> => {
    // ifAbsent and no hash: hashing content not yet on disk names bytes the
    // server cannot match, so it refuses every create.
    await api.vault.write({ path, content, ifAbsent: true });
    bases.set(path, content);
  };

  const write = async (path: string, content: string): Promise<void> => {
    const base = bases.get(path);
    // Not inferred from `content`: that would let a concurrent edit merge to
    // the disk's bytes alone and drop this write silently.
    if (base === undefined) {
      throw new Error(`write ${path}: no base was read, so nothing can guard this write`);
    }
    const expectedHash = await contentHashHex(base);
    const { error } = await safe(api.vault.write({ path, content, expectedHash }));
    if (error === null) {
      bases.set(path, content);
      return;
    }
    // No `current` means a delete raced the write; nothing to merge against.
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
    // Answers "trashed" for a real delete too: the session only needs the row gone.
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
