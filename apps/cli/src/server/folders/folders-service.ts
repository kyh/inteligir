// not a permission grant (the harness's shell already reads whatever the os lets this user
// read), so validation keeps the list honest rather than guarding access.

import { realpathSync, statSync } from "node:fs";
import nodePath from "node:path";

import { CONNECTED_FOLDERS_MAX } from "@repo/contract/local/folders/folders-schema";
import { pathContains } from "../path-containment";
import type { FoldersStore } from "./folders-store";

// per operation, so each handler's switch covers only the codes its own call can raise
export type FolderRefusal =
  | { op: "add"; code: "invalid_path" | "already_exists" | "limit_reached" }
  | { op: "remove"; code: "not_found" };

export class FolderRefusedError extends Error {
  readonly refusal: FolderRefusal;

  constructor(refusal: FolderRefusal, message: string) {
    super(message);
    this.name = "FolderRefusedError";
    this.refusal = refusal;
  }
}

const addRefused = (
  code: Extract<FolderRefusal, { op: "add" }>["code"],
  message: string,
): FolderRefusedError => new FolderRefusedError({ code, op: "add" }, message);

export interface FoldersService {
  list: () => string[];
  add: (path: string) => string[];
  remove: (path: string) => string[];
}

export interface CreateFoldersServiceArgs {
  store: FoldersStore;
  vaultDir: string;
  dataDir: string;
}

export const createFoldersService = (args: CreateFoldersServiceArgs): FoldersService => {
  const vaultDir = nodePath.resolve(args.vaultDir);
  const dataDir = nodePath.resolve(args.dataDir);

  const validate = (rawPath: string): string => {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0 || !nodePath.isAbsolute(trimmed)) {
      throw addRefused(
        "invalid_path",
        `connected folder must be an absolute path (got "${rawPath}")`,
      );
    }
    // realpathed so a symlinked spelling and its target are one row.
    let real: string;
    try {
      real = realpathSync(nodePath.resolve(trimmed));
    } catch {
      throw addRefused("invalid_path", `"${trimmed}" does not exist`);
    }
    let stats;
    try {
      stats = statSync(real);
    } catch {
      throw addRefused("invalid_path", `"${trimmed}" does not exist`);
    }
    if (!stats.isDirectory()) {
      throw addRefused("invalid_path", `"${trimmed}" is not a directory`);
    }
    if (pathContains(vaultDir, real)) {
      throw addRefused(
        "invalid_path",
        `"${real}" is inside the vault — the vault is already the agent's workspace`,
      );
    }
    if (pathContains(real, dataDir)) {
      throw addRefused(
        "invalid_path",
        `"${real}" contains the app's data directory — connect a narrower folder`,
      );
    }
    return real;
  };

  return {
    add(path: string): string[] {
      const real = validate(path);
      const folders = args.store.read();
      if (folders.includes(real)) {
        throw addRefused("already_exists", `"${real}" is already connected`);
      }
      if (folders.length >= CONNECTED_FOLDERS_MAX) {
        throw addRefused(
          "limit_reached",
          `at most ${CONNECTED_FOLDERS_MAX} folders can be connected`,
        );
      }
      const next = [...folders, real];
      args.store.write(next);
      return next;
    },
    list(): string[] {
      return args.store.read();
    },
    remove(path: string): string[] {
      // stored spelling first: a row whose directory is gone (realpath fails) must still be removable.
      const folders = args.store.read();
      let target = path.trim();
      if (!folders.includes(target)) {
        let real: string | null = null;
        try {
          real = realpathSync(nodePath.resolve(target));
        } catch {
          real = null;
        }
        if (real === null || !folders.includes(real)) {
          throw new FolderRefusedError(
            { code: "not_found", op: "remove" },
            `"${path}" is not a connected folder`,
          );
        }
        target = real;
      }
      const next = folders.filter((folder) => folder !== target);
      args.store.write(next);
      return next;
    },
  };
};
