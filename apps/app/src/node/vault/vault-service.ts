// File CRUD over the vault directory. Every mutation is announced through the
// DbNotifier and reported to `onMutated` (the git auto-commit scheduler), and
// runs inside the injected lock — the git engine's repo lock — so a write can
// never interleave a rebase's checkout/abort window. Reads stay lock-free.
//
// Containment is PHYSICAL, not just lexical: the resolved parent's realpath
// must land under the vault's realpath, and a symlink leaf is refused — a
// pulled `notes.md -> ~/.ssh/id_ed25519` must never read the key, and a
// symlinked folder must never let a write land outside the vault.

import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { DbNotifier } from "@repo/db/notifier";
import {
  VAULT_MAX_CONTENT_LENGTH,
  type VaultEntry,
  type VaultTreeResponse,
} from "@repo/server-contract/vault";
import { errnoCode } from "../errno";
import {
  isIgnoredEntryName,
  resolveVaultPath,
  VaultPathError,
  VAULT_TMP_PREFIX,
} from "./vault-paths";

export type VaultServiceErrorCode = "not_found" | "conflict" | "too_large";

export class VaultServiceError extends Error {
  readonly code: VaultServiceErrorCode;

  constructor(code: VaultServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function notFound(relPath: string): VaultServiceError {
  return new VaultServiceError("not_found", `No such vault entry: ${relPath}`);
}

function symlinkRefusal(relPath: string): VaultPathError {
  return new VaultPathError(`path is a symbolic link: ${relPath}`);
}

async function fsyncDirBestEffort(dirPath: string): Promise<void> {
  // Directory fsync is what makes the just-renamed entry durable; some
  // filesystems refuse it, and the file's own fsync has already landed, so a
  // refusal downgrades durability rather than correctness.
  try {
    const handle = await open(dirPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // See above.
  }
}

async function walk(absDir: string, relDir: string, entries: VaultEntry[]): Promise<void> {
  const dirents = await readdir(absDir, { withFileTypes: true });
  const dirs: string[] = [];
  const files: Array<{ name: string; size: number }> = [];
  for (const dirent of dirents) {
    if (isIgnoredEntryName(dirent.name)) {
      continue;
    }
    // withFileTypes has lstat semantics: a symlink is NEITHER isDirectory
    // nor isFile here, so links (to files and folders alike) fall through —
    // the listing never follows one out of the vault.
    if (dirent.isDirectory()) {
      dirs.push(dirent.name);
      continue;
    }
    if (dirent.isFile()) {
      const stats = await lstat(join(absDir, dirent.name)).catch(() => null);
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

export interface VaultServiceArgs {
  /** Absolute vault root; must already exist. */
  root: string;
  notifier: DbNotifier;
  /** Serializes every MUTATION (the git engine's repo lock in production). */
  lock?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Fired after every applied mutation with the vault-relative paths it
   *  touched; the runtime schedules a commit and arms echo suppression here. */
  onMutated?: (paths: readonly string[]) => void;
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
  // realpath, not resolve: every physical-containment check compares against
  // this, and the configured root may itself be spelled through a symlink
  // (macOS /var → /private/var).
  const rootReal = realpathSync(resolve(args.root));
  const lock = args.lock ?? (<T>(work: () => Promise<T>) => work());

  function isInsideRoot(realPath: string): boolean {
    return realPath === rootReal || realPath.startsWith(rootReal + sep);
  }

  /**
   * Physically verify the path's ancestry: the deepest EXISTING ancestor of
   * `absPath`, fully symlink-resolved, must sit inside the vault. Checked
   * BEFORE any mkdir, so a symlinked folder cannot even grow directories
   * outside the vault.
   */
  async function assertAncestryInsideVault(absPath: string): Promise<void> {
    let dir = dirname(absPath);
    // Terminates: the walk is capped at the (existing) vault root because
    // absPath is lexically inside it.
    while (!existsSync(dir)) {
      dir = dirname(dir);
    }
    const real = await realpath(dir);
    if (!isInsideRoot(real)) {
      throw new VaultPathError("path escapes the vault root through a symlinked folder");
    }
  }

  /** lstat that refuses a symlink leaf; null when the leaf does not exist. */
  async function lstatRefusingSymlink(absPath: string, relPath: string) {
    const stats = await lstat(absPath).catch(() => null);
    if (stats?.isSymbolicLink() === true) {
      throw symlinkRefusal(relPath);
    }
    return stats;
  }

  function announceMutation(paths: readonly string[]): void {
    args.notifier.notifyVault(["files-changed"]);
    args.onMutated?.(paths);
  }

  return {
    async listTree() {
      const entries: VaultEntry[] = [];
      await walk(rootReal, "", entries);
      return { root: rootReal, entries };
    },

    async read(path) {
      const { relPath, absPath } = resolveVaultPath(rootReal, path);
      await assertAncestryInsideVault(absPath);
      const stats = await lstatRefusingSymlink(absPath, relPath);
      if (stats === null || stats.isDirectory()) {
        throw notFound(relPath);
      }
      if (stats.size > VAULT_MAX_CONTENT_LENGTH) {
        throw new VaultServiceError(
          "too_large",
          `${relPath} is ${stats.size} bytes; the read cap is ${VAULT_MAX_CONTENT_LENGTH}`,
        );
      }
      const content = await readFile(absPath, "utf8").catch((error: unknown) => {
        const code = errnoCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw notFound(relPath);
        }
        throw error;
      });
      return { path: relPath, content };
    },

    write(path, content) {
      return lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        try {
          await mkdir(dirname(absPath), { recursive: true });
        } catch (error) {
          if (errnoCode(error) === "ENOTDIR") {
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
        await fsyncDirBestEffort(dirname(absPath));
        args.notifier.notifyDoc(relPath, ["content-changed"]);
        announceMutation([relPath]);
        return { path: relPath };
      });
    },

    rename(from, to) {
      return lock(async () => {
        const source = resolveVaultPath(rootReal, from);
        const target = resolveVaultPath(rootReal, to);
        await assertAncestryInsideVault(source.absPath);
        await assertAncestryInsideVault(target.absPath);
        const sourceStats = await lstatRefusingSymlink(source.absPath, source.relPath);
        if (sourceStats === null) {
          throw notFound(source.relPath);
        }
        const targetStats = await lstatRefusingSymlink(target.absPath, target.relPath);
        // On a case-insensitive filesystem a case-only rename finds "itself"
        // at the target; the inode check keeps that legal while refusing a
        // real overwrite.
        const sameEntry =
          targetStats !== null &&
          targetStats.dev === sourceStats.dev &&
          targetStats.ino === sourceStats.ino;
        await mkdir(dirname(target.absPath), { recursive: true });
        if (sourceStats.isFile() && !sameEntry) {
          // link() is the atomic refuse-overwrite: it FAILS with EEXIST when
          // the target appears between any check and the move, where a
          // stat-then-rename would silently clobber it.
          try {
            await link(source.absPath, target.absPath);
          } catch (error) {
            if (errnoCode(error) === "EEXIST") {
              throw new VaultServiceError("conflict", `Target already exists: ${target.relPath}`);
            }
            throw error;
          }
          await unlink(source.absPath);
        } else {
          // Directories (and the case-only retitle): link() cannot express
          // either, so this keeps the check-then-rename with its TOCTOU
          // window accepted — a same-instant external create at the target
          // can be clobbered, which local-first single-writer usage makes a
          // non-event.
          if (targetStats !== null && !sameEntry) {
            throw new VaultServiceError("conflict", `Target already exists: ${target.relPath}`);
          }
          await rename(source.absPath, target.absPath);
        }
        await fsyncDirBestEffort(dirname(target.absPath));
        if (dirname(source.absPath) !== dirname(target.absPath)) {
          await fsyncDirBestEffort(dirname(source.absPath));
        }
        announceMutation([source.relPath, target.relPath]);
        return { path: target.relPath };
      });
    },

    remove(path) {
      return lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const stats = await lstatRefusingSymlink(absPath, relPath);
        if (stats === null) {
          throw notFound(relPath);
        }
        await rm(absPath, { recursive: true });
        await fsyncDirBestEffort(dirname(absPath));
        announceMutation([relPath]);
      });
    },

    createDir(path) {
      return lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing !== null && !existing.isDirectory()) {
          throw new VaultServiceError("conflict", `A file already exists at ${relPath}`);
        }
        try {
          await mkdir(absPath, { recursive: true });
        } catch (error) {
          if (errnoCode(error) === "ENOTDIR") {
            throw new VaultServiceError("conflict", `A file shadows a parent folder of ${relPath}`);
          }
          throw error;
        }
        announceMutation([relPath]);
        return { path: relPath };
      });
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
