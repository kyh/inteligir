// containment is physical, not lexical: the deepest existing ancestor is realpathed and a
// symlink leaf is refused, since a pulled `notes.md -> ~/.ssh/id_ed25519` must never read the key.

import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
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
import path from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import type { VaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import {
  isIgnoredEntryName,
  VaultPathError,
  VAULT_TMP_PREFIX,
} from "@repo/notes/knowledge/vault-path";
import {
  contentHashHex,
  VAULT_ASSET_MAX_BYTES,
  VAULT_MAX_CONTENT_LENGTH,
} from "@repo/api/local/vault/vault-schema";
import type {
  VaultEntry,
  VaultTreeResponse,
  VaultWriteGuard,
} from "@repo/api/local/vault/vault-schema";
import { errnoCode } from "../errno";
import { pathContains } from "../path-containment";
import { ABSENT_ENTRY, entryFingerprintAt, fingerprintOf } from "./vault-changes";
import type { EntryFingerprint, VaultMutation } from "./vault-changes";
import type { ReadStall } from "./slow-reads";
import { resolveVaultPath } from "./vault-paths";

// VAULT_REFUSALS is total over this union, so a code added here without a wire class fails to
// compile there.
const VAULT_SERVICE_ERROR_CODES = ["not_found", "conflict", "too_large"] as const;

export type VaultServiceErrorCode = (typeof VAULT_SERVICE_ERROR_CODES)[number];

export class VaultServiceError extends Error {
  readonly code: VaultServiceErrorCode;

  constructor(code: VaultServiceErrorCode, message: string) {
    super(message);
    this.name = "VaultServiceError";
    this.code = code;
  }
}

const notFound = (relPath: string): VaultServiceError =>
  new VaultServiceError("not_found", `No such vault entry: ${relPath}`);

const symlinkRefusal = (relPath: string): VaultPathError =>
  new VaultPathError(`path is a symbolic link: ${relPath}`);

const fsyncDirBestEffort = async (dirPath: string): Promise<void> => {
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
};

// a folder that cannot be opened (no permission, or gone or swapped for a file mid-walk) keeps
// its own row and lists nothing under it: throwing would cost the whole listing, and the boot
// that walks it, for one folder.
const SKIPPED_FOLDER_CODES: ReadonlySet<string> = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR"]);

type UnreadableFolderSink = (relPath: string, code: string) => void;

const readSubfolder = async (
  absDir: string,
  relDir: string,
  onUnreadable: UnreadableFolderSink,
): Promise<Dirent[]> => {
  try {
    return await readdir(absDir, { withFileTypes: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === undefined || !SKIPPED_FOLDER_CODES.has(code)) {
      throw error;
    }
    onUnreadable(relDir, code);
    return [];
  }
};

interface WalkArgs {
  entries: VaultEntry[];
  ignore: VaultIgnore;
  onUnreadable: UnreadableFolderSink;
}

// the caller reads the root's dirents itself, so a root that cannot be read still throws.
const walk = async (
  absDir: string,
  relDir: string,
  dirents: readonly Dirent[],
  walkArgs: WalkArgs,
): Promise<void> => {
  const pathOf = (name: string): string => (relDir === "" ? name : `${relDir}/${name}`);
  const dirs: string[] = [];
  const files: string[] = [];
  for (const dirent of dirents) {
    // withFileTypes has lstat semantics: a symlink is neither isDirectory nor isFile, so links
    // fall through and the listing never follows one out of the vault.
    if (dirent.isDirectory()) {
      if (!walkArgs.ignore.ignores(pathOf(dirent.name), "dir")) {
        dirs.push(dirent.name);
      }
      continue;
    }
    if (dirent.isFile() && !walkArgs.ignore.ignores(pathOf(dirent.name), "file")) {
      files.push(dirent.name);
    }
  }
  dirs.sort();
  files.sort();
  for (const dir of dirs) {
    const relPath = pathOf(dir);
    const absPath = path.join(absDir, dir);
    walkArgs.entries.push({ kind: "dir", path: relPath });
    const children = await readSubfolder(absPath, relPath, walkArgs.onUnreadable);
    await walk(absPath, relPath, children, walkArgs);
  }
  const statted = await Promise.all(
    files.map(async (name) => {
      const stats = await lstat(path.join(absDir, name)).catch(() => null);
      return { modifiedMs: stats === null ? null : Math.trunc(stats.mtimeMs), name };
    }),
  );
  for (const { name, modifiedMs } of statted) {
    const relPath = pathOf(name);
    if (modifiedMs === null) {
      walkArgs.entries.push({ kind: "file", path: relPath });
    } else {
      walkArgs.entries.push({ kind: "file", modifiedMs, path: relPath });
    }
  }
};

// recursive: EEXIST means the last segment is a file, ENOTDIR an earlier one. either way a file
// stands where a folder must, which is the caller's conflict, not a fault.
const ensureDir = async (absDir: string, relPath: string): Promise<void> => {
  try {
    await mkdir(absDir, { recursive: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === "EEXIST" || code === "ENOTDIR") {
      throw new VaultServiceError("conflict", `A file stands in the way of ${relPath}`);
    }
    throw error;
  }
};

// exFAT, FAT and some SMB and NFS mounts refuse a hard link. EXDEV is not here: a rename fails
// the same way across devices.
const LINK_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  "EMLINK",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
]);

// link() fails with EEXIST if the target appears between the check and the move, where
// stat-then-rename would clobber it. false: this filesystem cannot link, and the caller renames.
const moveFileByLink = async (from: string, to: string, toRelPath: string): Promise<boolean> => {
  try {
    await link(from, to);
  } catch (error) {
    const code = errnoCode(error);
    if (code === "EEXIST") {
      throw new VaultServiceError("conflict", `Target already exists: ${toRelPath}`);
    }
    if (code !== undefined && LINK_UNSUPPORTED_CODES.has(code)) {
      return false;
    }
    throw error;
  }
  await unlink(from);
  return true;
};

export interface VaultServiceArgs {
  root: string;
  notifier: DbNotifier;
  // required, not defaulted: a forgotten arg silently dropped the serialization the cas guard needs.
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  // required for the same reason: a composition that forgot it would list every build output
  // the vault's .gitignore names.
  ignore: () => Promise<VaultIgnore>;
  onMutated?: (mutations: readonly VaultMutation[]) => void;
  // told on every walk that meets the folder; deduplicating is the sink's call.
  onUnreadableFolder?: UnreadableFolderSink;
  // awaited before a file's bytes are opened
  stallRead?: ReadStall;
}

type ConditionalWriteResult =
  | { applied: true; path: string }
  | { applied: false; reason: "changed" | "not_found" };

// the wire's guards less `overwrite`, which is `write`.
type GuardedWriteGuard = Exclude<VaultWriteGuard, { kind: "overwrite" }>;

type GuardedWriteResult =
  | { applied: true; path: string }
  | {
      applied: false;
      reason: "hash_mismatch";
      current: { content: string; hash: string } | null;
    }
  | { applied: false; reason: "exists" };

export interface VaultService {
  listTree: () => Promise<VaultTreeResponse>;
  statEntry: (path: string) => Promise<"file" | "dir" | null>;
  listFilesUnder: (path: string) => Promise<string[]>;
  read: (path: string) => Promise<{ path: string; content: string }>;
  statAsset: (path: string) => Promise<{ path: string; etag: string }>;
  readBytes: (
    path: string,
  ) => Promise<{ path: string; bytes: Uint8Array<ArrayBuffer>; etag: string }>;
  writeAsset: (dir: string, baseName: string, bytes: Uint8Array) => Promise<{ path: string }>;
  write: (path: string, content: string) => Promise<{ path: string }>;
  // an external editor is not serialized by the lock and can still race the window; accepted.
  writeIfUnchanged: (
    path: string,
    expected: string,
    content: string,
  ) => Promise<ConditionalWriteResult>;
  writeGuarded: (
    path: string,
    content: string,
    guard: GuardedWriteGuard,
  ) => Promise<GuardedWriteResult>;
  rename: (from: string, to: string) => Promise<{ path: string }>;
  remove: (path: string) => Promise<void>;
  removeIfUnchanged: (path: string, expected: string) => Promise<ConditionalWriteResult>;
  createDir: (path: string) => Promise<{ path: string }>;
}

// the read raced a delete or a folder swap: the caller's "no such entry" is the truthful answer.
// any other errno (EACCES, EIO) is a fault, and must not pass for a file that is gone.
const isGone = (cause: unknown): boolean => {
  const code = errnoCode(cause);
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
};

const readOrNotFound = async <T>(relPath: string, read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    throw isGone(error) ? notFound(relPath) : error;
  }
};

const readTextOrNull = async (absPath: string): Promise<string | null> => {
  try {
    return await readFile(absPath, "utf-8");
  } catch (error) {
    if (isGone(error)) {
      return null;
    }
    throw error;
  }
};

// a folder not there yet holds nothing; one a file stands in is the write's conflict to report.
const namesIn = async (absDir: string): Promise<string[]> => {
  try {
    return await readdir(absDir);
  } catch (error) {
    if (isGone(error)) {
      return [];
    }
    throw error;
  }
};

const lstatRefusingSymlink = async (absPath: string, relPath: string) => {
  const stats = await lstat(absPath).catch(() => null);
  if (stats?.isSymbolicLink() === true) {
    throw symlinkRefusal(relPath);
  }
  return stats;
};

export const createVaultService = (args: VaultServiceArgs): VaultService => {
  // realpath, not resolve: the root may be spelled through a symlink (macos /var → /private/var).
  const rootReal = realpathSync(path.resolve(args.root));
  const { lock } = args;
  const onUnreadableFolder: UnreadableFolderSink =
    args.onUnreadableFolder ??
    (() => {
      /* empty */
    });

  // checked before any mkdir, so a symlinked folder cannot grow directories outside the vault.
  const assertAncestryInsideVault = async (absPath: string): Promise<void> => {
    let dir = path.dirname(absPath);
    // terminates: absPath is lexically inside the existing vault root.
    while (!existsSync(dir)) {
      dir = path.dirname(dir);
    }
    const real = await realpath(dir);
    if (!pathContains(rootReal, real)) {
      throw new VaultPathError("path escapes the vault root through a symlinked folder");
    }
  };

  // files-changed makes every client re-walk the vault, so only a mutation that moved a row says it.
  const announceMutation = (mutations: readonly VaultMutation[]): void => {
    args.notifier.notifyVault(
      ["files-changed"],
      mutations.map((mutation) => mutation.path),
    );
    args.onMutated?.(mutations);
  };

  // a content-only write says content-changed alone: saying files-changed too costs the open
  // note two reads and the workspace a re-walk per autosave. `replacing` is the entry this write
  // replaces, null for a create.
  const performAtomicWrite = async (
    relPath: string,
    absPath: string,
    content: string | Uint8Array,
    replacing: Stats | null,
  ): Promise<void> => {
    await ensureDir(path.dirname(absPath), relPath);
    const tmpPath = path.join(
      path.dirname(absPath),
      `${VAULT_TMP_PREFIX}${randomBytes(8).toString("hex")}`,
    );
    let fingerprint: EntryFingerprint;
    try {
      const handle = await open(tmpPath, "w");
      try {
        // the encoding only applies to a string; node ignores it for bytes.
        await handle.writeFile(content, "utf-8");
        // the staging file is born at the umask's mode, so a note kept at 0600 would widen on
        // its first save. the remainder drops the file-type field above the permission bits.
        if (replacing !== null) {
          await handle.chmod(replacing.mode % 0o1_0000);
        }
        await handle.sync();
        // read off the handle, not an lstat after the rename: the rename keeps all three
        // fields, and an lstat could already see a foreign write that landed behind this one.
        fingerprint = fingerprintOf(await handle.stat());
      } finally {
        await handle.close();
      }
      await rename(tmpPath, absPath);
    } catch (error) {
      await unlink(tmpPath).catch(() => {
        /* empty */
      });
      throw error;
    }
    await fsyncDirBestEffort(path.dirname(absPath));
    args.notifier.notifyDoc(relPath, ["content-changed"]);
    if (replacing === null) {
      args.notifier.notifyVault(["files-changed"], [relPath]);
    }
    args.onMutated?.([{ fingerprint, path: relPath }]);
  };

  const resolveAsset = async (requestedPath: string) => {
    const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
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
    return { absPath, etag, relPath };
  };

  return {
    async createDir(requestedPath) {
      return await lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing !== null && !existing.isDirectory()) {
          throw new VaultServiceError("conflict", `A file already exists at ${relPath}`);
        }
        await ensureDir(absPath, relPath);
        announceMutation([{ fingerprint: await entryFingerprintAt(absPath), path: relPath }]);
        return { path: relPath };
      });
    },

    async listFilesUnder(requestedPath) {
      let relPath: string;
      let absPath: string;
      try {
        ({ relPath, absPath } = resolveVaultPath(rootReal, requestedPath));
      } catch {
        return [];
      }
      const ignore = await args.ignore();
      if (ignore.ignores(relPath, "dir")) {
        return [];
      }
      const entries: VaultEntry[] = [];
      try {
        const dirents = await readdir(absPath, { withFileTypes: true });
        await walk(absPath, relPath, dirents, {
          entries,
          ignore,
          onUnreadable: onUnreadableFolder,
        });
      } catch {
        // Gone or not a directory: nothing under it to index.
      }
      return entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
    },

    async listTree() {
      const entries: VaultEntry[] = [];
      const ignore = await args.ignore();
      const dirents = await readdir(rootReal, { withFileTypes: true });
      await walk(rootReal, "", dirents, { entries, ignore, onUnreadable: onUnreadableFolder });
      // basename here, not a split in the browser: this side knows the machine's separator.
      return { entries, name: path.basename(rootReal) || rootReal, root: rootReal };
    },

    async read(requestedPath) {
      const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
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
      await args.stallRead?.(relPath);
      const content = await readOrNotFound(relPath, async () => await readFile(absPath, "utf-8"));
      return { content, path: relPath };
    },

    async readBytes(requestedPath) {
      const { relPath, absPath, etag } = await resolveAsset(requestedPath);
      await args.stallRead?.(relPath);
      const buffer = await readOrNotFound(relPath, async () => await readFile(absPath));
      // a copy, not the read's Buffer: its backing store is node's shared pool, which a
      // Response body will not take.
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      return { bytes, etag, path: relPath };
    },

    async remove(requestedPath) {
      await lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const stats = await lstatRefusingSymlink(absPath, relPath);
        if (stats === null) {
          throw notFound(relPath);
        }
        await rm(absPath, { recursive: true });
        await fsyncDirBestEffort(path.dirname(absPath));
        announceMutation([{ fingerprint: ABSENT_ENTRY, path: relPath }]);
      });
    },

    async removeIfUnchanged(requestedPath, expected) {
      return await lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const stats = await lstatRefusingSymlink(absPath, relPath);
        if (stats === null || stats.isDirectory()) {
          return { applied: false, reason: "not_found" };
        }
        const current = await readTextOrNull(absPath);
        if (current === null) {
          return { applied: false, reason: "not_found" };
        }
        if (current !== expected) {
          return { applied: false, reason: "changed" };
        }
        await rm(absPath);
        await fsyncDirBestEffort(path.dirname(absPath));
        announceMutation([{ fingerprint: ABSENT_ENTRY, path: relPath }]);
        return { applied: true, path: relPath };
      });
    },

    async rename(from, to) {
      return await lock(async () => {
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
        await ensureDir(path.dirname(target.absPath), target.relPath);
        const linked =
          sourceStats.isFile() &&
          !sameEntry &&
          (await moveFileByLink(source.absPath, target.absPath, target.relPath));
        if (!linked) {
          // a directory, a case-only retitle, or a filesystem that cannot link keeps the
          // check-then-rename toctou window; the lock serializes this service's own writers.
          if (targetStats !== null && !sameEntry) {
            throw new VaultServiceError("conflict", `Target already exists: ${target.relPath}`);
          }
          await rename(source.absPath, target.absPath);
        }
        await fsyncDirBestEffort(path.dirname(target.absPath));
        if (path.dirname(source.absPath) !== path.dirname(target.absPath)) {
          await fsyncDirBestEffort(path.dirname(source.absPath));
        }
        const moved = await entryFingerprintAt(target.absPath);
        announceMutation([
          // a case-only retitle leaves the old spelling answering for the same entry.
          { fingerprint: sameEntry ? moved : ABSENT_ENTRY, path: source.relPath },
          { fingerprint: moved, path: target.relPath },
        ]);
        return { path: target.relPath };
      });
    },

    async statAsset(requestedPath) {
      const { relPath, etag } = await resolveAsset(requestedPath);
      return { etag, path: relPath };
    },

    async statEntry(requestedPath) {
      let relPath: string;
      let absPath: string;
      try {
        ({ relPath, absPath } = resolveVaultPath(rootReal, requestedPath));
      } catch {
        return null;
      }
      const stats = await lstat(absPath).catch(() => null);
      if (stats === null || stats.isSymbolicLink()) {
        return null;
      }
      // the listing leaves out what the vault ignores; a stat must agree.
      const ignore = await args.ignore();
      if (stats.isDirectory()) {
        return ignore.ignores(relPath, "dir") ? null : "dir";
      }
      return stats.isFile() && !ignore.ignores(relPath, "file") ? "file" : null;
    },

    async write(requestedPath, content) {
      return await lock(async () => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        await performAtomicWrite(relPath, absPath, content, existing);
        return { path: relPath };
      });
    },

    async writeAsset(dir, baseName, bytes) {
      return await lock(async () => {
        const dot = baseName.lastIndexOf(".");
        const ext = dot > 0 ? baseName.slice(dot).toLowerCase() : "";
        const stem = (dot > 0 ? baseName.slice(0, dot) : baseName)
          .replaceAll(/[^\p{L}\p{N}._ -]+/gu, "-")
          .replaceAll(/^[.\s-]+|[.\s-]+$/gu, "");
        const safeStem = stem === "" ? "asset" : stem;
        const candidate = (n: number) => {
          const name = n === 1 ? `${safeStem}${ext}` : `${safeStem}-${n}${ext}`;
          return resolveVaultPath(rootReal, dir === "" ? name : `${dir}/${name}`);
        };
        const first = candidate(1);
        // every candidate shares this folder, so its ancestry is checked once, before the read.
        await assertAncestryInsideVault(first.absPath);
        // one read of the folder, not a stat per name: a folder holding a thousand pastes of one
        // name would otherwise probe a thousand paths under the lock. case-folded, since a
        // case-insensitive filesystem answers `Shot.png` for `shot.png`.
        const listed = await namesIn(path.dirname(first.absPath));
        const taken = new Set(listed.map((name) => name.toLowerCase()));
        for (let n = 1; ; n += 1) {
          const { relPath, absPath } = n === 1 ? first : candidate(n);
          if (taken.has(path.basename(absPath).toLowerCase())) {
            continue;
          }
          // the race guard: a writer outside this service may have landed since the read.
          if ((await lstatRefusingSymlink(absPath, relPath)) !== null) {
            continue;
          }
          await performAtomicWrite(relPath, absPath, bytes, null);
          return { path: relPath };
        }
      });
    },

    async writeGuarded(requestedPath, content, guard) {
      return await lock(async (): Promise<GuardedWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        if (guard.kind === "absent") {
          if (existing !== null) {
            return { applied: false, reason: "exists" };
          }
          await performAtomicWrite(relPath, absPath, content, null);
          return { applied: true, path: relPath };
        }
        const current = existing === null ? null : await readTextOrNull(absPath);
        if (current === null) {
          // the base the client hashed no longer exists.
          return { applied: false, current: null, reason: "hash_mismatch" };
        }
        const currentHash = await contentHashHex(current);
        if (currentHash !== guard.hash) {
          return {
            applied: false,
            current: { content: current, hash: currentHash },
            reason: "hash_mismatch",
          };
        }
        await performAtomicWrite(relPath, absPath, content, existing);
        return { applied: true, path: relPath };
      });
    },

    async writeIfUnchanged(requestedPath, expected, content) {
      return await lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
        await assertAncestryInsideVault(absPath);
        const existing = await lstatRefusingSymlink(absPath, relPath);
        if (existing === null || existing.isDirectory()) {
          return { applied: false, reason: "not_found" };
        }
        const current = await readTextOrNull(absPath);
        if (current === null) {
          return { applied: false, reason: "not_found" };
        }
        if (current !== expected) {
          return { applied: false, reason: "changed" };
        }
        await performAtomicWrite(relPath, absPath, content, existing);
        return { applied: true, path: relPath };
      });
    },
  };
};

// housekeeping nothing waits on: git add never stages one (info/exclude) and the listing and
// watcher filter the name. a candidate younger than olderThan is somebody's in-flight write.
export const sweepStaleTmpFiles = async (root: string, olderThan: number): Promise<void> => {
  const resolvedRoot = path.resolve(root);
  const sweep = async (absDir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const absPath = path.join(absDir, dirent.name);
      if (dirent.name.startsWith(VAULT_TMP_PREFIX) && dirent.isFile()) {
        const stats = await lstat(absPath).catch(() => null);
        if (stats !== null && stats.mtimeMs < olderThan) {
          await unlink(absPath).catch(() => {
            /* empty */
          });
        }
        continue;
      }
      if (dirent.isDirectory() && !isIgnoredEntryName(dirent.name)) {
        await sweep(absPath);
      }
    }
  };
  await sweep(resolvedRoot);
};
