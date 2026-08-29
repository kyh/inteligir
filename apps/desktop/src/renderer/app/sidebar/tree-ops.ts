// What the file tree's context ops MEAN to the workspace: the tree owns view
// state and hands every mutation out through `TreeOps`, and this is the one
// implementation of it — the session for anything that touches a file, the
// api for a folder, and the open note kept honest through both.

import { useMemo, type RefObject } from "react";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import type { VaultActions } from "@repo/editor/host";
import type { VaultMkdirRequest, VaultMkdirResponse } from "@repo/api/local/vault/vault-schema";
import { refusalMessage } from "../api";
import type { TreeOps } from "./file-tree";

/** The one procedure a tree op reaches that the session does not carry —
 *  structurally, so a caller (and a test) hands over what this uses rather
 *  than the whole client. */
interface TreeOpsApi {
  vault: {
    mkdir(input: VaultMkdirRequest): Promise<VaultMkdirResponse>;
  };
}

/** The session ops the tree asks for. Ref-held: the vault session mounts
 *  INSIDE the workspace, below the component that owns these. */
type TreeVaultActions = Pick<VaultActions, "renameEntry" | "deleteEntry">;

/**
 * Where the open note lands when the entry renamed is one of its ANCESTOR
 * folders, and null when the rename does not reach it. The session flushes,
 * carries and toasts a rename of the FILE itself, so that case answers null
 * too — a second remap here would be a second answer to the same question.
 */
export function openNoteAfterRename(
  openNote: string | null,
  fromPath: string,
  toPath: string,
): string | null {
  if (openNote === null || openNote === fromPath || !openNote.startsWith(`${fromPath}/`)) {
    return null;
  }
  return `${toPath}/${openNote.slice(fromPath.length + 1)}`;
}

/** True when deleting `path` takes the open note down with it. The session
 *  tracks the file itself, so a folder delete that swallows it leaves a
 *  selection nothing can open. */
export function deleteSwallowsOpenNote(openNote: string | null, path: string): boolean {
  return openNote !== null && openNote !== path && openNote.startsWith(`${path}/`);
}

interface TreeOpsDeps {
  api: TreeOpsApi;
  actions: RefObject<TreeVaultActions | null>;
  /** Open-or-create through the session — an existing note is OPENED, never
   *  overwritten. */
  createNote: (path: string, content?: string) => Promise<void>;
  openNote: string | null;
  setOpenNote: (path: string | null) => void;
}

export function useTreeOps({
  api,
  actions,
  createNote,
  openNote,
  setOpenNote,
}: TreeOpsDeps): TreeOps {
  return useMemo<TreeOps>(
    () => ({
      createNote: (path) => {
        void createNote(path);
      },
      createFolder: (path) => {
        void (async () => {
          try {
            await api.vault.mkdir({ path });
          } catch (error) {
            toast.error(refusalMessage(error, `Could not create ${path}.`));
          }
        })();
      },
      renameEntry: (fromPath, toPath) => {
        void (async () => {
          const moved = await actions.current?.renameEntry(fromPath, toPath);
          const carried = openNoteAfterRename(openNote, fromPath, toPath);
          if (moved === true && carried !== null) {
            setOpenNote(carried);
          }
        })();
      },
      removeEntry: (path, kind) => {
        void (async () => {
          const confirmed = await confirm({
            title: kind === "dir" ? `Delete the folder ${path}?` : `Delete ${path}?`,
            body:
              kind === "dir"
                ? "Everything inside it is deleted with it."
                : "It moves to Trash and is kept for 30 days.",
            confirmLabel: "Delete",
            destructive: true,
          });
          if (!confirmed) {
            return;
          }
          await actions.current?.deleteEntry(path);
          if (deleteSwallowsOpenNote(openNote, path)) {
            setOpenNote(null);
          }
        })();
      },
    }),
    [api, actions, createNote, openNote, setOpenNote],
  );
}
