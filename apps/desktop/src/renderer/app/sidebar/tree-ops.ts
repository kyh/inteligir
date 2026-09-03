import { useMemo, type RefObject } from "react";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import type { VaultActions } from "@repo/editor/host-io";
import type { VaultMkdirRequest, VaultMkdirResponse } from "@repo/api/local/vault/vault-schema";
import { refusalMessage } from "../api";
import type { TreeOps } from "./file-tree";

interface TreeOpsApi {
  vault: {
    mkdir(input: VaultMkdirRequest): Promise<VaultMkdirResponse>;
  };
}

// Ref-held: the vault session mounts below the component that owns these.
type TreeVaultActions = Pick<VaultActions, "renameEntry" | "deleteEntry">;

// A rename of the open file itself answers null: the session already carries
// that case, and a second remap here could disagree with it.
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

export function deleteSwallowsOpenNote(openNote: string | null, path: string): boolean {
  return openNote !== null && openNote !== path && openNote.startsWith(`${path}/`);
}

interface TreeOpsDeps {
  api: TreeOpsApi;
  actions: RefObject<TreeVaultActions | null>;
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
                ? "Everything inside it goes with it. Notes stay recoverable from Deleted notes."
                : "It stays recoverable from Deleted notes.",
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
