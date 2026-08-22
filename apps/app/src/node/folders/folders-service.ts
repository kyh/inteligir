// Connected Folders policy (issue #601, Moss parity): the directories agent
// sessions are TOLD ABOUT as read-only reference context. Not a permission
// grant — the harness's shell can already read whatever the OS lets this user
// read — so validation here is about keeping the LIST honest, not about
// access: a row must be a real directory, named absolutely, and must not
// restate a root the session already has (the vault) or expose a nesting that
// makes no sense (a folder holding the data dir would "connect" the app's own
// database and secrets as reference reading).

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { CONNECTED_FOLDERS_MAX } from "@repo/server-contract/folders";
import { pathContains } from "../path-containment";
import type { FoldersStore } from "./folders-store";

/** A write refused for what the path is; `kind` picks the wire status. */
export class FolderRefusedError extends Error {
  readonly kind: "invalid-path" | "already-exists" | "not-found";

  constructor(kind: "invalid-path" | "already-exists" | "not-found", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface FoldersService {
  list(): string[];
  add(path: string): string[];
  remove(path: string): string[];
}

export interface CreateFoldersServiceArgs {
  store: FoldersStore;
  /** Both already resolved, the same values the boot assertions compared. */
  vaultDir: string;
  dataDir: string;
}

export function createFoldersService(args: CreateFoldersServiceArgs): FoldersService {
  const vaultDir = resolve(args.vaultDir);
  const dataDir = resolve(args.dataDir);

  const validate = (rawPath: string): string => {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0 || !isAbsolute(trimmed)) {
      throw new FolderRefusedError(
        "invalid-path",
        `connected folder must be an absolute path (got "${rawPath}")`,
      );
    }
    // Realpathed so a symlinked spelling and its target are ONE row, and so
    // the containment checks below compare physical locations.
    let real: string;
    try {
      real = realpathSync(resolve(trimmed));
    } catch {
      throw new FolderRefusedError("invalid-path", `"${trimmed}" does not exist`);
    }
    let stats;
    try {
      stats = statSync(real);
    } catch {
      throw new FolderRefusedError("invalid-path", `"${trimmed}" does not exist`);
    }
    if (!stats.isDirectory()) {
      throw new FolderRefusedError("invalid-path", `"${trimmed}" is not a directory`);
    }
    if (pathContains(vaultDir, real)) {
      throw new FolderRefusedError(
        "invalid-path",
        `"${real}" is inside the vault — the vault is already the agent's workspace`,
      );
    }
    if (pathContains(real, dataDir)) {
      throw new FolderRefusedError(
        "invalid-path",
        `"${real}" contains the app's data directory — connect a narrower folder`,
      );
    }
    return real;
  };

  return {
    list(): string[] {
      return args.store.read();
    },
    add(path: string): string[] {
      const real = validate(path);
      const folders = args.store.read();
      if (folders.includes(real)) {
        throw new FolderRefusedError("already-exists", `"${real}" is already connected`);
      }
      if (folders.length >= CONNECTED_FOLDERS_MAX) {
        throw new FolderRefusedError(
          "invalid-path",
          `at most ${CONNECTED_FOLDERS_MAX} folders can be connected`,
        );
      }
      const next = [...folders, real];
      args.store.write(next);
      return next;
    },
    remove(path: string): string[] {
      // Removal matches the STORED spelling verbatim first, so a row whose
      // directory has since been deleted (realpath now fails) is still
      // removable; the resolved form is only a fallback courtesy.
      const folders = args.store.read();
      let target = path.trim();
      if (!folders.includes(target)) {
        let real: string | null = null;
        try {
          real = realpathSync(resolve(target));
        } catch {
          real = null;
        }
        if (real === null || !folders.includes(real)) {
          throw new FolderRefusedError("not-found", `"${path}" is not a connected folder`);
        }
        target = real;
      }
      const next = folders.filter((folder) => folder !== target);
      args.store.write(next);
      return next;
    },
  };
}
