// CLAUDE.md § A MOVE IS A RENAME THAT KEEPS THE NAME. The rail's and the library's file verbs over
// the vault session, which carries or closes the open item for a rename or delete of it or of a
// folder above it, so nothing here does.

import { useMemo } from "react";
import type { RefObject } from "react";
import { confirm } from "@repo/ui/components/confirm-dialog";
import type { VaultActions } from "@repo/editor/host-io";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { client, failed } from "../api";
import { desktopPaths, runPathAction } from "../desktop-paths";

// Ref-held: the vault session mounts below the component that owns these.
type TreeVaultActions = Pick<VaultActions, "renameEntry" | "deleteEntry">;

export interface TreeOps {
  createNote: (path: string) => void;
  createFolder: (path: string) => void;
  // false when the session refused it, and said why
  renameEntry: (fromPath: string, toPath: string) => Promise<boolean>;
  // into `toDir` ("" is the library's root), keeping the entry's own name
  moveEntry: (fromPath: string, toDir: string) => Promise<boolean>;
  // a folder is asked about first: everything inside goes with it
  removeFolder: (path: string) => void;
  setPinned: (path: string, pinned: boolean) => void;
  // present under the shell alone: the OS is reached through it, and a browser tab has no shell
  revealEntry?: (path: string) => void;
  openEntry?: (path: string) => void;
}

export type MoveVerdict =
  | { ok: true; to: string }
  | { ok: false; reason: "self" | "descendant" | "same-parent" };

// One predicate for every drop target and the palette's folder page, so a folder row refuses a
// drop and the palette hides a folder for the same three reasons. "" is the library's root.
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
  createNote: (path: string) => Promise<void>;
  setPinned: (path: string, pinned: boolean) => void;
}

// The memo is the hook's one hook, so it stays: the compiler skips a hook that calls none, which
// would mint the ops every render, and a plain factory taking the ref bails its caller out.
export const useTreeOps = ({ actions, createNote, setPinned }: TreeOpsDeps): TreeOps =>
  useMemo<TreeOps>(() => {
    const paths = desktopPaths();
    // absent outside the shell, so no surface draws a row for them there
    const shellOps: Pick<TreeOps, "revealEntry" | "openEntry"> =
      paths === undefined
        ? {}
        : {
            openEntry: (path) => {
              runPathAction(async () => await paths.open({ path }), `Could not open ${path}.`);
            },
            revealEntry: (path) => {
              runPathAction(async () => await paths.reveal({ path }), `Could not reveal ${path}.`);
            },
          };
    const renameEntry: TreeOps["renameEntry"] = async (fromPath, toPath) =>
      (await actions.current?.renameEntry(fromPath, toPath)) ?? false;
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
      moveEntry: async (fromPath, toDir) => {
        const plan = planMove(fromPath, toDir);
        return plan.ok ? await renameEntry(fromPath, plan.to) : false;
      },
      removeFolder: (path) => {
        void (async () => {
          const confirmed = await confirm({
            body: "Everything inside it goes with it. Every item stays recoverable from Deleted.",
            confirmLabel: "Delete",
            destructive: true,
            title: `Delete the folder ${path}?`,
          });
          if (!confirmed) {
            return;
          }
          await actions.current?.deleteEntry(path);
        })();
      },
    };
  }, [actions, createNote, setPinned]);
