// containment is physical, not lexical: the deepest existing ancestor is realpathed and a
// symlink leaf is refused, since a pulled `notes.md -> ~/.ssh/id_ed25519` must never read the key.

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
import { basename, dirname, join, resolve } from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  isIgnoredEntryName,
  VaultPathError,
  VAULT_TMP_PREFIX,
} from "@repo/notes/knowledge/vault-path";
import {
  contentHashHex,
  VAULT_ASSET_MAX_BYTES,
  VAULT_MAX_CONTENT_LENGTH,
  type VaultEntry,
  type VaultTreeResponse,
} from "@repo/api/local/vault/vault-schema";
import { errnoCode } from "../errno";
import { pathContains, relativeUnder } from "../path-containment";
import { resolveVaultPath } from "./vault-paths";

// VAULT_REFUSALS is total over this union, so a code added here without a wire class fails to
// compile there.
const VAULT_SERVICE_ERROR_CODES = ["not_found", "conflict", "too_large"] as const;

export type VaultServiceErrorCode = (typeof VAULT_SERVICE_ERROR_CODES)[number];

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
  // some filesystems refuse a directory fsync; the file's own fsync has landed, so a refusal
  // downgrades durability, not correctness.
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
  const files: string[] = [];
  for (const dirent of dirents) {
    if (isIgnoredEntryName(dirent.name)) {
      continue;
    }
    // withFileTypes has lstat semantics: a symlink is neither isDirectory nor isFile, so links
    // fall through and the listing never follows one out of the vault.
    if (dirent.isDirectory()) {
      dirs.push(dirent.name);
      continue;
    }
    if (dirent.isFile()) {
      files.push(dirent.name);
    }
  }
  dirs.sort();
  files.sort();
  for (const dir of dirs) {
    const relPath = relDir === "" ? dir : `${relDir}/${dir}`;
    entries.push({ kind: "dir", path: relPath });
    await walk(join(absDir, dir), relPath, entries);
  }
  const statted = await Promise.all(
    files.map(async (name) => {
      const stats = await lstat(join(absDir, name)).catch(() => null);
      return { modifiedMs: stats === null ? null : Math.trunc(stats.mtimeMs), name };
    }),
  );
  for (const { name, modifiedMs } of statted) {
    const path = relDir === "" ? name : `${relDir}/${name}`;
    if (modifiedMs === null) {
      entries.push({ kind: "file", path });
    } else {
      entries.push({ kind: "file", modifiedMs, path });
    }
  }
}

export interface VaultServiceArgs {
  root: string;
  notifier: DbNotifier;
  // required, not defaulted: a forgotten arg silently dropped the serialization the cas guard needs.
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  onMutated?: (paths: readonly string[]) => void;
}

type ConditionalWriteResult =
  | { applied: true; path: string }
  | { applied: false; reason: "changed" | "not_found" };

export type GuardedWriteGuard = { expectedHash: string } | { ifAbsent: true };

type GuardedWriteResult =
  | { applied: true; path: string }
  | {
      applied: false;
      reason: "hash_mismatch";
      current: { content: string; hash: string } | null;
    }
  | { applied: false; reason: "exists" };

export interface VaultService {
  listTree(): Promise<VaultTreeResponse>;
  statEntry(path: string): Promise<"file" | "dir" | null>;
  listFilesUnder(path: string): Promise<string[]>;
  read(path: string): Promise<{ path: string; content: string }>;
  statAsset(path: string): Promise<{ path: string; etag: string }>;
  readBytes(path: string): Promise<{ path: string; bytes: Uint8Array<ArrayBuffer>; etag: string }>;
  writeAsset(dir: string, baseName: string, bytes: Uint8Array): Promise<{ path: string }>;
  write(path: string, content: string): Promise<{ path: string }>;
  // an external editor is not serialized by the lock and can still race the window; accepted.
  writeIfUnchanged(
    path: string,
    expected: string,
    content: string,
  ): Promise<ConditionalWriteResult>;
  writeGuarded(
    path: string,
    content: string,
    guard: GuardedWriteGuard,
  ): Promise<GuardedWriteResult>;
  rename(from: string, to: string): Promise<{ path: string }>;
  remove(path: string): Promise<void>;
  removeIfUnchanged(path: string, expected: string): Promise<ConditionalWriteResult>;
  createDir(path: string): Promise<{ path: string }>;
}

export function createVaultService(args: VaultServiceArgs): VaultService {
  // realpath, not resolve: the root may be spelled through a symlink (macos /var → /private/var).
  const rootReal = realpathSync(resolve(args.root));
  const lock = args.lock;

  // checked before any mkdir, so a symlinked folder cannot grow directories outside the vault.
  async function assertAncestryInsideVault(absPath: string): Promise<void> {
    let dir = dirname(absPath);
    // terminates: absPath is lexically inside the existing vault root.
    while (!existsSync(dir)) {
      dir = dirname(dir);
    }
    const real = await realpath(dir);
    if (!pathContains(rootReal, real)) {
      throw new VaultPathError("path escapes the vault root through a symlinked folder");
    }
  }

  async function lstatRefusingSymlink(absPath: string, relPath: string) {
    const stats = await lstat(absPath).catch(() => null);
    if (stats?.isSymbolicLink() === true) {
      throw symlinkRefusal(relPath);
    }
    return stats;
  }

  // files-changed makes every client re-walk the vault, so only a mutation that moved a row says it.
  function announceMutation(paths: readonly string[]): void {
    args.notifier.notifyVault(["files-changed"], paths);
    args.onMutated?.(paths);
  }

  // a content-only write says content-changed alone: saying files-changed too costs the open
  // note two reads and the workspace a re-walk per autosave.
  async function performAtomicWrite(
    relPath: string,
    absPath: string,
    content: string | Uint8Array,
    created: boolean,
  ): Promise<void> {
    try {
      await mkdir(dirname(absPath), { recursive: true });
    } catch (error) {
      if (errnoCode(error) === "ENOTDIR") {
        throw new VaultServiceError("conflict", `A file shadows a parent folder of ${relPath}`);
      }
      throw error;
    }
    const tmpPath = join(dirname(absPath), `${VAULT_TMP_PREFIX}${randomBytes(8).toString("hex")}`);
    try {
      const handle = await open(tmpPath, "w");
      try {
        if (content instanceof Uint8Array) {
          await handle.writeFile(content);
        } else {
          await handle.writeFile(content, "utf8");
        }
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
    if (created) {
      args.notifier.notifyVault(["files-changed"], [relPath]);
    }
    args.onMutated?.([relPath]);
  }

  async function resolveAsset(path: string) {
    const { relPath, absPath } = resolveVaultPath(rootReal, path);
    await assertAncestryInsideVault(absPath);
    const stats = await lstatRefusingSymlink(absPath, relPath);
    if (stats === null || stats.isDirectory()) {
      throw notFound(relPath);
    }
    if (stats.size > VAULT_ASSET_MAX_BYTES) {
      throw new VaultServiceError(
        "too_large",
        `${relPath} is ${stats.size} bytes; the asset cap is ${VAULT_ASSET_MAX_BYTES}`,
      );
    }
    const etag = `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
    return { relPath, absPath, etag };
  }

  return {
    async listTree() {
      const entries: VaultEntry[] = [];
      await walk(rootReal, "", entries);
      // basename here, not a split in the browser: this side knows the machine's separator.
      return { root: rootReal, name: basename(rootReal) || rootReal, entries };
    },

    async statEntry(path) {
      let relPath: string;
      let absPath: string;
      try {
        ({ relPath, absPath } = resolveVaultPath(rootReal, path));
      } catch {
        return null;
      }
      const stats = await lstat(absPath).catch(() => null);
      if (stats === null || stats.isSymbolicLink()) {
        return null;
      }
      // the listing hides ignored names; a stat must agree.
      if (relPath.split("/").some((segment) => isIgnoredEntryName(segment))) {
        return null;
      }
      if (stats.isDirectory()) {
        return "dir";
      }
      return stats.isFile() ? "file" : null;
    },

    async listFilesUnder(path) {
      let relPath: string;
      let absPath: string;
      try {
        ({ relPath, absPath } = resolveVaultPath(rootReal, path));
      } catch {
        return [];
      }
      const entries: VaultEntry[] = [];
      await walk(absPath, relPath, entries).catch(() => {
        // Gone or not a directory: nothing under it to index.
      });
      return entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
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
      const content = await readFile(absPath, "utf8").catch((cause: unknown) => {
        const code = errnoCode(cause);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw notFound(relPath);
        }
        throw cause;
      });
      return { path: relPath, content };
    },

    async statAsset(path) {
      const { relPath, etag } = await resolveAsset(path);
      return { path: relPath, etag };
    },

    async readBytes(path) {
      const { relPath, absPath, etag } = await resolveAsset(path);
      const buffer = await readFile(absPath).catch((cause: unknown) => {
        const code = errnoCode(cause);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw notFound(relPath);
        }
        throw cause;
      });
      // a copy, not the read's Buffer: its backing store is node's shared pool, which a
      // Response body will not take.
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      return { path: relPath, bytes, etag };
    },

    writeAsset(dir, baseName, bytes) {
      return lock(async () => {
        const dot = baseName.lastIndexOf(".");
        const ext = dot > 0 ? baseName.slice(dot).toLowerCase() : "";
        const stem = (dot > 0 ? baseName.slice(0, dot) : baseName)
          .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
          .replace(/^[.\s-]+|[.\s-]+$/g, "");
        const safeStem = stem === "" ? "asset" : stem;
        for (let attempt = 0; attempt < 1000; attempt++) {
          const name = attempt === 0 ? `${safeStem}${ext}` : `${safeStem}-${attempt + 1}${ext}`;
          const { relPath, absPath } = resolveVaultPath(
            rootReal,
            dir === "" ? name : `${dir}/${name}`,
          );
          await assertAncestryInsideVault(absPath);
          const existing = await lstatRefusingSymlink(absPath, relPath);
          if (existing !== null) continue;
          await performAtomicWrite(relPath, absPath, bytes, true);
          return { path: relPath };
        }
        throw new VaultServiceError("conflict", `no free name for ${baseName} under ${dir}`);
      });
    },

    write(path, content) {
      return lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        await performAtomicWrite(relPath, absPath, content, existing === null);
        return { path: relPath };
      });
    },

    writeIfUnchanged(path, expected, content) {
      return lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing === null || existing.isDirectory()) {
          return { applied: false, reason: "not_found" };
        }
        const current = await readFile(absPath, "utf8").catch(() => null);
        if (current === null) {
          return { applied: false, reason: "not_found" };
        }
        if (current !== expected) {
          return { applied: false, reason: "changed" };
        }
        await performAtomicWrite(relPath, absPath, content, false);
        return { applied: true, path: relPath };
      });
    },

    writeGuarded(path, content, guard) {
      return lock(async (): Promise<GuardedWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        if ("ifAbsent" in guard) {
          if (existing !== null) {
            return { applied: false, reason: "exists" };
          }
          await performAtomicWrite(relPath, absPath, content, true);
          return { applied: true, path: relPath };
        }
        const current =
          existing === null ? null : await readFile(absPath, "utf8").catch(() => null);
        if (current === null) {
          // the base the client hashed no longer exists.
          return { applied: false, reason: "hash_mismatch", current: null };
        }
        const currentHash = await contentHashHex(current);
        if (currentHash !== guard.expectedHash) {
          return {
            applied: false,
            reason: "hash_mismatch",
            current: { content: current, hash: currentHash },
          };
        }
        await performAtomicWrite(relPath, absPath, content, false);
        return { applied: true, path: relPath };
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
        // a case-only rename on a case-insensitive filesystem finds itself at the target; the
        // inode check keeps that legal.
        const sameEntry =
          targetStats !== null &&
          targetStats.dev === sourceStats.dev &&
          targetStats.ino === sourceStats.ino;
        await mkdir(dirname(target.absPath), { recursive: true });
        if (sourceStats.isFile() && !sameEntry) {
          // link() fails with EEXIST if the target appears between the check and the move;
          // stat-then-rename would clobber it.
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
          // link() cannot move a directory or do a case-only retitle, so this keeps the
          // check-then-rename toctou window.
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

    removeIfUnchanged(path, expected) {
      return lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, path);
        await assertAncestryInsideVault(absPath);
        const stats = await lstatRefusingSymlink(absPath, relPath);
        if (stats === null || stats.isDirectory()) {
          return { applied: false, reason: "not_found" };
        }
        const current = await readFile(absPath, "utf8").catch(() => null);
        if (current === null) {
          return { applied: false, reason: "not_found" };
        }
        if (current !== expected) {
          return { applied: false, reason: "changed" };
        }
        await rm(absPath);
        await fsyncDirBestEffort(dirname(absPath));
        announceMutation([relPath]);
        return { applied: true, path: relPath };
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

// housekeeping nothing waits on: git add never stages one (info/exclude) and the listing and
// watcher filter the name. a candidate younger than olderThan is somebody's in-flight write.
export async function sweepStaleTmpFiles(root: string, olderThan: number): Promise<void> {
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
      if (relativeUnder(resolvedRoot, absPath) === null) {
        continue;
      }
      if (dirent.name.startsWith(VAULT_TMP_PREFIX) && dirent.isFile()) {
        const stats = await lstat(absPath).catch(() => null);
        if (stats !== null && stats.mtimeMs < olderThan) {
          await unlink(absPath).catch(() => {});
        }
        continue;
      }
      if (dirent.isDirectory() && !isIgnoredEntryName(dirent.name)) {
        await sweep(absPath);
      }
    }
  }
  await sweep(resolvedRoot);
}
