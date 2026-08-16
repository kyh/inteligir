// File CRUD over the vault directory. Every mutation is announced through the
// DbNotifier and reported to `onMutated` (the git auto-commit scheduler).
// Writes are atomic: staged to a sibling tmp file, fsynced, then renamed into
// place — a crash mid-write leaves a stale staging file, never a partial note.

import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { DbNotifier } from "@repo/db/notifier";
import type { VaultEntry, VaultTreeResponse } from "@repo/server-contract/vault";
import { isIgnoredEntryName, resolveVaultPath, VAULT_TMP_PREFIX } from "./vault-paths";

export type VaultServiceErrorCode = "not_found" | "conflict";

export class VaultServiceError extends Error {
  readonly code: VaultServiceErrorCode;

  constructor(code: VaultServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fsErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function notFound(relPath: string): VaultServiceError {
  return new VaultServiceError("not_found", `No such vault entry: ${relPath}`);
}

export interface VaultServiceArgs {
  /** Absolute vault root; must already exist. */
  root: string;
  notifier: DbNotifier;
  /** Fired after every applied mutation; the runtime schedules a commit here. */
  onMutated?: () => void;
  /** Absolute paths inside the root the listing must never descend into
   *  (a data dir nested in the vault). */
  ignoreAbsPaths?: readonly string[];
}

export interface VaultService {
  listTree(): Promise<VaultTreeResponse>;
  read(path: string): Promise<{ path: string; content: string }>;
  write(path: string, content: string): Promise<{ path: string }>;
  rename(from: string, to: string): Promise<{ path: string }>;
  remove(path: string): Promise<void>;
  createDir(path: string): Promise<{ path: string }>;
}

export function createVaultService(args: VaultServiceArgs): VaultService {
  const root = resolve(args.root);
  const ignoreAbsPaths = (args.ignoreAbsPaths ?? []).map((path) => resolve(path));

  function isIgnoredAbsPath(absPath: string): boolean {
    return ignoreAbsPaths.some((ignored) => absPath === ignored);
  }

  function announceMutation(): void {
    args.notifier.notifyVault(["files-changed"]);
    args.onMutated?.();
  }

  async function walk(absDir: string, relDir: string, entries: VaultEntry[]): Promise<void> {
    const dirents = await readdir(absDir, { withFileTypes: true });
    const dirs: string[] = [];
    const files: Array<{ name: string; size: number }> = [];
    for (const dirent of dirents) {
      if (isIgnoredEntryName(dirent.name) || isIgnoredAbsPath(join(absDir, dirent.name))) {
        continue;
      }
      if (dirent.isDirectory()) {
        dirs.push(dirent.name);
        continue;
      }
      // Symlinks are skipped, not followed: a link out of the vault would walk
      // arbitrary disk into the listing.
      if (dirent.isFile()) {
        const stats = await stat(join(absDir, dirent.name)).catch(() => null);
        if (stats?.isFile() === true) {
          files.push({ name: dirent.name, size: stats.size });
        }
      }
    }
    dirs.sort();
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dir of dirs) {
      const relPath = relDir === "" ? dir : `${relDir}/${dir}`;
      entries.push({ kind: "dir", path: relPath });
      await walk(join(absDir, dir), relPath, entries);
    }
    for (const file of files) {
      entries.push({
        kind: "file",
        path: relDir === "" ? file.name : `${relDir}/${file.name}`,
        size: file.size,
      });
    }
  }

  return {
    async listTree() {
      const entries: VaultEntry[] = [];
      await walk(root, "", entries);
      return { root, entries };
    },

    async read(path) {
      const { relPath, absPath } = resolveVaultPath(root, path);
      let content: string;
      try {
        content = await readFile(absPath, "utf8");
      } catch (error) {
        const code = fsErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw notFound(relPath);
        }
        throw error;
      }
      return { path: relPath, content };
    },

    async write(path, content) {
      const { relPath, absPath } = resolveVaultPath(root, path);
      const existing = await stat(absPath).catch(() => null);
      if (existing?.isDirectory() === true) {
        throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
      }
      try {
        await mkdir(dirname(absPath), { recursive: true });
      } catch (error) {
        if (fsErrorCode(error) === "ENOTDIR") {
          throw new VaultServiceError("conflict", `A file shadows a parent folder of ${relPath}`);
        }
        throw error;
      }
      const tmpPath = join(
        dirname(absPath),
        `${VAULT_TMP_PREFIX}${randomBytes(8).toString("hex")}`,
      );
      try {
        const handle = await open(tmpPath, "w");
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tmpPath, absPath);
      } catch (error) {
        await unlink(tmpPath).catch(() => {});
        throw error;
      }
      args.notifier.notifyDoc(relPath, ["content-changed"]);
      announceMutation();
      return { path: relPath };
    },

    async rename(from, to) {
      const source = resolveVaultPath(root, from);
      const target = resolveVaultPath(root, to);
      const sourceStats = await stat(source.absPath).catch(() => null);
      if (sourceStats === null) {
        throw notFound(source.relPath);
      }
      const targetStats = await stat(target.absPath).catch(() => null);
      // On a case-insensitive filesystem a case-only rename finds "itself" at
      // the target; the inode check keeps that legal while refusing a real
      // overwrite.
      const sameEntry =
        targetStats !== null &&
        targetStats.dev === sourceStats.dev &&
        targetStats.ino === sourceStats.ino;
      if (targetStats !== null && !sameEntry) {
        throw new VaultServiceError("conflict", `Target already exists: ${target.relPath}`);
      }
      await mkdir(dirname(target.absPath), { recursive: true });
      await rename(source.absPath, target.absPath);
      announceMutation();
      return { path: target.relPath };
    },

    async remove(path) {
      const { relPath, absPath } = resolveVaultPath(root, path);
      const stats = await stat(absPath).catch(() => null);
      if (stats === null) {
        throw notFound(relPath);
      }
      await rm(absPath, { recursive: true });
      announceMutation();
    },

    async createDir(path) {
      const { relPath, absPath } = resolveVaultPath(root, path);
      const existing = await stat(absPath).catch(() => null);
      if (existing !== null && !existing.isDirectory()) {
        throw new VaultServiceError("conflict", `A file already exists at ${relPath}`);
      }
      try {
        await mkdir(absPath, { recursive: true });
      } catch (error) {
        if (fsErrorCode(error) === "ENOTDIR") {
          throw new VaultServiceError("conflict", `A file shadows a parent folder of ${relPath}`);
        }
        throw error;
      }
      announceMutation();
      return { path: relPath };
    },
  };
}

/**
 * Remove staging files a crash left behind. Runs once at boot, before the
 * watcher starts and before the first auto-commit can `git add` them.
 */
export async function sweepStaleTmpFiles(root: string): Promise<void> {
  const resolvedRoot = resolve(root);
  async function sweep(absDir: string): Promise<void> {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const absPath = join(absDir, dirent.name);
      if (!absPath.startsWith(resolvedRoot + sep)) {
        continue;
      }
      if (dirent.name.startsWith(VAULT_TMP_PREFIX) && dirent.isFile()) {
        await unlink(absPath).catch(() => {});
        continue;
      }
      if (dirent.isDirectory() && !isIgnoredEntryName(dirent.name)) {
        await sweep(absPath);
      }
    }
  }
  await sweep(resolvedRoot);
}
