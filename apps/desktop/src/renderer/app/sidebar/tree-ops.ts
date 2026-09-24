import { useMemo } from "react";
import type { RefObject } from "react";
import { confirm } from "@repo/ui/components/confirm-dialog";
import type { VaultActions } from "@repo/editor/host-io";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { client, failed } from "../api";
import { desktopPaths, runPathAction } from "../desktop-paths";
import type { TreeOps } from "./file-tree";

// Ref-held: the vault session mounts below the component that owns these. The session carries
// or closes the open note for a rename or delete of it or a folder above it, so nothing here does.
type TreeVaultActions = Pick<VaultActions, "renameEntry" | "deleteEntry">;

// the server's root is a native path, so the join keeps its separator; the entry is always "/"-joined
export const absoluteEntryPath = (root: string, path: string): string => {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${path.split("/").join(separator)}`;
};

export type MoveVerdict =
  | { ok: true; to: string }
  | { ok: false; reason: "self" | "descendant" | "same-parent" };

// One predicate for the drop target and the palette's folder page, so the tree refuses a
// drop and the palette hides a folder for the same three reasons. "" is the vault root.
export const planMove = (from: string, toDir: string): MoveVerdict => {
  if (toDir === from) {
    return { ok: false, reason: "self" };
  }
  if (toDir.startsWith(`${from}/`)) {
    return { ok: false, reason: "descendant" };
  }
  if (toDir === dirnamePath(from)) {
    return { ok: false, reason: "same-parent" };
  }
  return { ok: true, to: joinPath(toDir, basenamePath(from)) };
};

interface TreeOpsDeps {
  actions: RefObject<TreeVaultActions | null>;
  createNote: (path: string, content?: string) => Promise<void>;
  setPinned: (path: string, pinned: boolean) => void;
}

export const useTreeOps = ({ actions, createNote, setPinned }: TreeOpsDeps): TreeOps =>
  useMemo<TreeOps>(() => {
    const paths = desktopPaths();
    // absent outside the shell, so the tree draws no row for them there
    const shellOps: Pick<TreeOps, "revealEntry" | "openEntry"> =
      paths === undefined
        ? {}
        : {
            openEntry: (path) => {
              runPathAction(async () => await paths.open(path), `Could not open ${path}.`);
            },
            revealEntry: (path) => {
              runPathAction(async () => await paths.reveal(path), `Could not reveal ${path}.`);
            },
          };
    const renameEntry: TreeOps["renameEntry"] = (fromPath, toPath) => {
      void actions.current?.renameEntry(fromPath, toPath);
    };
    return {
      createFolder: (path) => {
        void (async () => {
          try {
            await client.vault.mkdir({ path });
          } catch (error) {
            failed(error, `Could not create ${path}.`);
          }
        })();
      },
      createNote: (path) => {
        void createNote(path);
      },
      renameEntry,
      setPinned,
      ...shellOps,
      moveEntry: (fromPath, toDir) => {
        const plan = planMove(fromPath, toDir);
        if (plan.ok) {
          renameEntry(fromPath, plan.to);
        }
      },
      removeEntry: (path, kind) => {
        void (async () => {
          const confirmed = await confirm({
            body:
              kind === "dir"
                ? "Everything inside it goes with it. Notes stay recoverable from Deleted notes."
                : "It stays recoverable from Deleted notes.",
            confirmLabel: "Delete",
            destructive: true,
            title: kind === "dir" ? `Delete the folder ${path}?` : `Delete ${path}?`,
          });
          if (!confirmed) {
            return;
          }
          await actions.current?.deleteEntry(path);
        })();
      },
    };
  }, [actions, createNote, setPinned]);
