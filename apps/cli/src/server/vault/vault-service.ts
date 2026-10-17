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
import type { VaultIgnore } from "@repo/notes/knowledge/vault-ignore";
import { freeAssetPath } from "@repo/notes/knowledge/asset-name";
import {
  dirnamePath,
  joinPath,
  VaultPathError,
  VAULT_TMP_PREFIX,
} from "@repo/notes/knowledge/vault-path";
import {
  VAULT_ASSET_MAX_BYTES,
  VAULT_MAX_CONTENT_LENGTH,
} from "@repo/contract/local/vault/vault-schema";
import type { VaultEntry, VaultTreeResponse } from "@repo/contract/local/vault/vault-schema";
import { errnoCode } from "../errno";
import { pathContains } from "../path-containment";
import { ABSENT_ENTRY, entryFingerprintAt, fingerprintOf } from "./vault-changes";
import type { EntryFingerprint, VaultMutation } from "./vault-changes";
import { createReadSlots } from "./read-slots";
import type { ReadLane } from "./read-slots";
import type { ReadStall } from "./slow-reads";
import { resolveVaultPath } from "./vault-paths";
import { judgeGuard } from "./write-guard";
import type { GuardedWriteGuard, GuardedWriteResult } from "./write-guard";

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

// what a walk meets, before the listing's wire shape: a file's lstat is kept whole so the index
// can skip a doc whose size and mtime did not move. `stat` is null when the lstat failed.
type WalkedEntry =
  | { kind: "dir"; path: string }
  | { kind: "file"; path: string; stat: VaultFileStat | null };

interface WalkArgs {
  entries: WalkedEntry[];
  ignore: VaultIgnore;
  onUnreadable: UnreadableFolderSink;
  // a directory walk reads every folder and stats no file
  files: boolean;
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
  if (!walkArgs.files) {
    return;
  }
  const statted = await Promise.all(
    files.map(async (name) => {
      const stats = await lstat(path.join(absDir, name)).catch(() => null);
      return { name, stats };
    }),
  );
  for (const { name, stats } of statted) {
    walkArgs.entries.push({
      kind: "file",
      path: pathOf(name),
      stat: stats === null ? null : { mtimeMs: stats.mtimeMs, size: stats.size },
    });
  }
};

const toVaultEntry = (entry: WalkedEntry): VaultEntry => {
  if (entry.kind === "dir" || entry.stat === null) {
    return { kind: entry.kind, path: entry.path };
  }
  return { kind: "file", modifiedMs: Math.trunc(entry.stat.mtimeMs), path: entry.path };
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
  // required, not defaulted: the cas guard needs this serialization, and a default would hide a
  // composition that omits it.
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  // required for the same reason: a composition that forgot it would list every build output
  // the vault's .gitignore names.
  ignore: () => Promise<VaultIgnore>;
  // the service's one report of what it changed, under the lock; what each kind announces is
  // the runtime's call.
  onMutated?: (mutations: readonly VaultMutation[]) => void;
  // told on every walk that meets the folder; deduplicating is the sink's call.
  onUnreadableFolder?: UnreadableFolderSink;
  // awaited inside the read's slot, before the file's bytes are opened, so a stalled stand-in holds
  // the slot a stalled open would
  stallRead?: ReadStall | undefined;
}

// a file's size and mtime as its lstat answered them, whole: the knowledge index's fingerprint
interface VaultFileStat {
  size: number;
  mtimeMs: number;
}

export interface VaultListedFile extends VaultFileStat {
  path: string;
}

type VaultEntryStat = ({ kind: "file" } & VaultFileStat) | { kind: "dir" };

type ConditionalWriteResult =
  | { applied: true; path: string }
  | { applied: false; reason: "changed" | "not_found" };

export interface VaultService {
  listTree: () => Promise<VaultTreeResponse>;
  statEntry: (path: string) => Promise<"file" | "dir" | null>;
  listFilesUnder: (path: string) => Promise<string[]>;
  // the server's own reads, off the wire: the walk's files with their stats, and its folders,
  // the whole vault's or the ones under `under`; a file whose lstat failed is left out
  listFileStats: (under?: string) => Promise<VaultListedFile[]>;
  listDirs: (under?: string) => Promise<string[]>;
  // statEntry with the file's stat; null for anything the listing would not show
  statFile: (path: string) => Promise<VaultEntryStat | null>;
  // a read takes a slot of the process's fs budget (read-slots.ts) while the bytes are opened;
  // absent, its lane is foreground, and a job nobody waits on says background.
  read: (path: string, lane?: ReadLane) => Promise<{ path: string; content: string }>;
  statAsset: (path: string) => Promise<{ path: string; etag: string }>;
  readBytes: (
    path: string,
    lane?: ReadLane,
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
  // a server composes one vault service, so these are the process's. a write's own read of the
  // bytes it replaces takes none, so a save never waits behind a stalled read.
  const readSlots = createReadSlots();
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

  // `replacing` is the entry this write replaces, null for a create, whose row is new.
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
    args.onMutated?.([
      { fingerprint, kind: replacing === null ? "entry" : "content", path: relPath },
    ]);
  };

  // every surface that takes a path starts here, the stat and the listing included, so none of
  // them answers through a symlinked folder the rest refuse. throws VaultPathError.
  const contained = async (requestedPath: string) => {
    const { relPath, absPath } = resolveVaultPath(rootReal, requestedPath);
    await assertAncestryInsideVault(absPath);
    const stats = await lstatRefusingSymlink(absPath, relPath);
    return { absPath, relPath, stats };
  };

  // the stat and the listing answer a refused path, or one whose folder went mid-check, as an
  // absent one: either way no vault entry stands there.
  const containedEntry = async (requestedPath: string) => {
    try {
      const { absPath, relPath, stats } = await contained(requestedPath);
      return stats === null ? null : { absPath, relPath, stats };
    } catch (error) {
      if (error instanceof VaultPathError || isGone(error)) {
        return null;
      }
      throw error;
    }
  };

  const resolveAsset = async (requestedPath: string) => {
    const { relPath, absPath, stats } = await contained(requestedPath);
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

  // the whole vault, or the folder `under` (nothing when it is not a listed folder); the root
  // that cannot be read throws, a folder below it that cannot is skipped
  const walkUnder = async (under: string | undefined, files: boolean): Promise<WalkedEntry[]> => {
    const entries: WalkedEntry[] = [];
    const ignore = await args.ignore();
    if (under === undefined) {
      const dirents = await readdir(rootReal, { withFileTypes: true });
      await walk(rootReal, "", dirents, {
        entries,
        files,
        ignore,
        onUnreadable: onUnreadableFolder,
      });
      return entries;
    }
    const folder = await containedEntry(under);
    if (folder === null || !folder.stats.isDirectory()) {
      return [];
    }
    const { relPath, absPath } = folder;
    if (ignore.ignores(relPath, "dir")) {
      return [];
    }
    try {
      const dirents = await readdir(absPath, { withFileTypes: true });
      await walk(absPath, relPath, dirents, {
        entries,
        files,
        ignore,
        onUnreadable: onUnreadableFolder,
      });
    } catch {
      // Gone or swapped for a file since the stat: nothing under it to list.
    }
    return entries;
  };

  // the listing leaves out what the vault ignores; a stat must agree.
  const statListed = async (requestedPath: string): Promise<VaultEntryStat | null> => {
    const entry = await containedEntry(requestedPath);
    if (entry === null) {
      return null;
    }
    const { relPath, stats } = entry;
    const ignore = await args.ignore();
    if (stats.isDirectory()) {
      return ignore.ignores(relPath, "dir") ? null : { kind: "dir" };
    }
    return stats.isFile() && !ignore.ignores(relPath, "file")
      ? { kind: "file", mtimeMs: stats.mtimeMs, size: stats.size }
      : null;
  };

  return {
    async createDir(requestedPath) {
      return await lock(async () => {
        const { relPath, absPath, stats: existing } = await contained(requestedPath);
        if (existing !== null && !existing.isDirectory()) {
          throw new VaultServiceError("conflict", `A file already exists at ${relPath}`);
        }
        await ensureDir(absPath, relPath);
        args.onMutated?.([
          { fingerprint: await entryFingerprintAt(absPath), kind: "entry", path: relPath },
        ]);
        return { path: relPath };
      });
    },

    async listDirs(under) {
      const walked = await walkUnder(under, false);
      return walked.flatMap((entry) => (entry.kind === "dir" ? [entry.path] : []));
    },

    async listFileStats(under) {
      const walked = await walkUnder(under, true);
      return walked.flatMap((entry) =>
        entry.kind === "file" && entry.stat !== null ? [{ path: entry.path, ...entry.stat }] : [],
      );
    },

    async listFilesUnder(requestedPath) {
      const walked = await walkUnder(requestedPath, true);
      return walked.flatMap((entry) => (entry.kind === "file" ? [entry.path] : []));
    },

    async listTree() {
      const walked = await walkUnder(undefined, true);
      // basename here, not a split in the browser: this side knows the machine's separator.
      return {
        entries: walked.map(toVaultEntry),
        name: path.basename(rootReal) || rootReal,
        root: rootReal,
      };
    },

    async read(requestedPath, lane = "foreground") {
      const { relPath, absPath, stats } = await contained(requestedPath);
      if (stats === null || stats.isDirectory()) {
        throw notFound(relPath);
      }
      if (stats.size > VAULT_MAX_CONTENT_LENGTH) {
        throw new VaultServiceError(
          "too_large",
          `${relPath} is ${stats.size} bytes; the read cap is ${VAULT_MAX_CONTENT_LENGTH}`,
        );
      }
      const content = await readSlots.hold(lane, async () => {
        await args.stallRead?.(relPath);
        return await readOrNotFound(relPath, async () => await readFile(absPath, "utf-8"));
      });
      return { content, path: relPath };
    },

    async readBytes(requestedPath, lane = "foreground") {
      const { relPath, absPath, etag } = await resolveAsset(requestedPath);
      const buffer = await readSlots.hold(lane, async () => {
        await args.stallRead?.(relPath);
        return await readOrNotFound(relPath, async () => await readFile(absPath));
      });
      // a copy, not the read's Buffer: its backing store is node's shared pool, which a
      // Response body will not take.
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      return { bytes, etag, path: relPath };
    },

    async remove(requestedPath) {
      await lock(async () => {
        const { relPath, absPath, stats } = await contained(requestedPath);
        if (stats === null) {
          throw notFound(relPath);
        }
        await rm(absPath, { recursive: true });
        await fsyncDirBestEffort(path.dirname(absPath));
        args.onMutated?.([{ fingerprint: ABSENT_ENTRY, kind: "entry", path: relPath }]);
      });
    },

    async removeIfUnchanged(requestedPath, expected) {
      return await lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath, stats } = await contained(requestedPath);
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
        args.onMutated?.([{ fingerprint: ABSENT_ENTRY, kind: "entry", path: relPath }]);
        return { applied: true, path: relPath };
      });
    },

    async rename(from, to) {
      return await lock(async () => {
        const source = await contained(from);
        const target = await contained(to);
        const { stats: sourceStats } = source;
        if (sourceStats === null) {
          throw notFound(source.relPath);
        }
        const { stats: targetStats } = target;
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
        args.onMutated?.([
          // a case-only retitle leaves the old spelling answering for the same entry.
          { fingerprint: sameEntry ? moved : ABSENT_ENTRY, kind: "entry", path: source.relPath },
          { fingerprint: moved, kind: "entry", path: target.relPath },
        ]);
        return { path: target.relPath };
      });
    },

    async statAsset(requestedPath) {
      const { relPath, etag } = await resolveAsset(requestedPath);
      return { etag, path: relPath };
    },

    async statEntry(requestedPath) {
      const stat = await statListed(requestedPath);
      return stat?.kind ?? null;
    },

    statFile: statListed,

    async write(requestedPath, content) {
      return await lock(async () => {
        const { relPath, absPath, stats: existing } = await contained(requestedPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        await performAtomicWrite(relPath, absPath, content, existing);
        return { path: relPath };
      });
    },

    async writeAsset(dir, baseName, bytes) {
      return await lock(async () => {
        const taken: string[] = [];
        const first = resolveVaultPath(rootReal, freeAssetPath(dir, baseName, taken));
        // not `contained` per candidate: every candidate shares this folder, so its ancestry is
        // checked once, before the read, and each name only for a symlink.
        await assertAncestryInsideVault(first.absPath);
        // one read of the folder, not a stat per name: a folder holding a thousand pastes of one
        // name would otherwise probe a thousand paths under the lock.
        const folder = dirnamePath(first.relPath);
        const listed = await namesIn(path.dirname(first.absPath));
        taken.push(...listed.map((name) => joinPath(folder, name)));
        for (;;) {
          const { relPath, absPath } = resolveVaultPath(
            rootReal,
            freeAssetPath(folder, baseName, taken),
          );
          // the race guard: a writer outside this service may have landed since the read.
          if ((await lstatRefusingSymlink(absPath, relPath)) !== null) {
            taken.push(relPath);
            continue;
          }
          await performAtomicWrite(relPath, absPath, bytes, null);
          return { path: relPath };
        }
      });
    },

    async writeGuarded(requestedPath, content, guard) {
      return await lock(async (): Promise<GuardedWriteResult> => {
        const { relPath, absPath, stats: existing } = await contained(requestedPath);
        if (existing?.isDirectory() === true) {
          throw new VaultServiceError("conflict", `A folder already exists at ${relPath}`);
        }
        const refusal = await judgeGuard(
          guard,
          existing === null ? null : async () => await readTextOrNull(absPath),
        );
        if (refusal !== null) {
          return refusal;
        }
        await performAtomicWrite(relPath, absPath, content, existing);
        return { applied: true, path: relPath };
      });
    },

    async writeIfUnchanged(requestedPath, expected, content) {
      return await lock(async (): Promise<ConditionalWriteResult> => {
        const { relPath, absPath, stats: existing } = await contained(requestedPath);
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
// watcher filter the name. a candidate younger than olderThan is somebody's in-flight write. a
// folder the vault ignores is never entered, so a gitignored node_modules costs the walk nothing,
// and a staging file left under one stays as invisible as it was.
export const sweepStaleTmpFiles = async (
  root: string,
  olderThan: number,
  ignore: VaultIgnore,
): Promise<void> => {
  const resolvedRoot = path.resolve(root);
  const sweep = async (absDir: string, relDir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const absPath = path.join(absDir, dirent.name);
      const relPath = relDir === "" ? dirent.name : `${relDir}/${dirent.name}`;
      if (dirent.name.startsWith(VAULT_TMP_PREFIX) && dirent.isFile()) {
        const stats = await lstat(absPath).catch(() => null);
        if (stats !== null && stats.mtimeMs < olderThan) {
          await unlink(absPath).catch(() => {
            /* empty */
          });
        }
        continue;
      }
      // the rules carry the floor too, so `.git` is never entered either.
      if (dirent.isDirectory() && !ignore.ignores(relPath, "dir")) {
        await sweep(absPath, relPath);
      }
    }
  };
  await sweep(resolvedRoot, "");
};
