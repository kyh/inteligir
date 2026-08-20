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
import { basename, dirname, join, resolve } from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import {
  isIgnoredEntryName,
  VaultPathError,
  VAULT_TMP_PREFIX,
} from "@repo/notes/knowledge/vault-path";
import type { ApiErrorCode } from "@repo/server-contract/errors";
import {
  contentHashHex,
  VAULT_MAX_CONTENT_LENGTH,
  type VaultEntry,
  type VaultTreeResponse,
} from "@repo/server-contract/vault";
import { errnoCode } from "../errno";
import { pathContains, relativeUnder } from "../path-containment";
import { resolveVaultPath } from "./vault-paths";

/**
 * The refusal classes the vault service itself raises — a SUBSET of the API's
 * vocabulary, held against it rather than restated. The service is below the
 * routes and answers no status, but the words it throws are the words the wire
 * carries, so a class the contract renames or retires must break HERE, at the
 * three throw sites, and not silently become a body no client can switch on.
 */
const VAULT_SERVICE_ERROR_CODES = [
  "not_found",
  "conflict",
  "too_large",
] as const satisfies readonly ApiErrorCode[];

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
  const files: string[] = [];
  for (const dirent of dirents) {
    if (isIgnoredEntryName(dirent.name)) {
      continue;
    }
    // withFileTypes has lstat semantics: a symlink is NEITHER isDirectory
    // nor isFile here, so links (to files and folders alike) fall through —
    // the listing never follows one out of the vault. It is also the whole
    // answer: an entry's kind and path are all a row carries, so the walk owes
    // the filesystem one readdir per directory and no stat at all.
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
  for (const name of files) {
    entries.push({ kind: "file", path: relDir === "" ? name : `${relDir}/${name}` });
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

type ConditionalWriteResult =
  | { applied: true; path: string }
  | { applied: false; reason: "changed" | "not_found" };

/** The client-facing compare-and-swap guard: either "my base hashed to this"
 *  or "nothing exists here yet". */
export type GuardedWriteGuard = { expectedHash: string } | { ifAbsent: true };

type GuardedWriteResult =
  | { applied: true; path: string }
  | {
      applied: false;
      reason: "hash_mismatch";
      /** What the file holds NOW — null when it no longer exists. */
      current: { content: string; hash: string } | null;
    }
  | { applied: false; reason: "exists" };

export interface VaultService {
  listTree(): Promise<VaultTreeResponse>;
  /** What ONE path is, without listing the vault — the targeted alternative
   *  to `listTree` for a consumer that already knows which paths moved. null
   *  covers "missing" and every entry the vault refuses to expose (a symlink,
   *  a staging file, anything under .git). */
  statEntry(path: string): Promise<"file" | "dir" | null>;
  /** The file paths under a directory, depth-first — `listTree` scoped to one
   *  announced subtree. An empty result covers a missing or empty folder. */
  listFilesUnder(path: string): Promise<string[]>;
  read(path: string): Promise<{ path: string; content: string }>;
  /** A file's raw BYTES, under exactly the containment rules `read` applies —
   *  the asset route's read. `etag` is derived from size and mtime, which is
   *  what lets an `<img>` that re-mounts revalidate instead of re-downloading;
   *  the bytes are COPIED into an ArrayBuffer of their own, because a Buffer
   *  is a view into a pooled allocation that hono's body types refuse. */
  readBytes(path: string): Promise<{ path: string; bytes: ArrayBuffer; etag: string }>;
  write(path: string, content: string): Promise<{ path: string }>;
  /** Write `content` only if the file still holds exactly `expected`, with the
   *  read and the write inside ONE turn of the mutation lock — the rename
   *  rewrite's guard against clobbering a concurrent service edit. A writer
   *  outside the service (an external editor) is not serialized by the lock
   *  and can still race the window; that residue is accepted for a
   *  local-first single-writer vault. */
  writeIfUnchanged(
    path: string,
    expected: string,
    content: string,
  ): Promise<ConditionalWriteResult>;
  /** The API write's compare-and-swap: apply `content` only when the guard
   *  holds against the file's CURRENT bytes, read and written inside ONE turn
   *  of the mutation lock. A hash mismatch reports what the file holds now so
   *  the caller can merge and retry. */
  writeGuarded(
    path: string,
    content: string,
    guard: GuardedWriteGuard,
  ): Promise<GuardedWriteResult>;
  rename(from: string, to: string): Promise<{ path: string }>;
  remove(path: string): Promise<void>;
  /** `remove` under the same guard `writeIfUnchanged` applies: delete the
   *  file only while it still holds exactly `expected`. The delete half of a
   *  review-mode turn's revert, where a concurrent writer must keep its bytes
   *  rather than lose them to a rollback of somebody else's write. */
  removeIfUnchanged(path: string, expected: string): Promise<ConditionalWriteResult>;
  createDir(path: string): Promise<{ path: string }>;
}

export function createVaultService(args: VaultServiceArgs): VaultService {
  // realpath, not resolve: every physical-containment check compares against
  // this, and the configured root may itself be spelled through a symlink
  // (macOS /var → /private/var).
  const rootReal = realpathSync(resolve(args.root));
  const lock = args.lock ?? (<T>(work: () => Promise<T>) => work());

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
    if (!pathContains(rootReal, real)) {
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

  /** A mutation that changed the TREE — a create, a delete, a rename, a new
   *  folder. `files-changed` is what makes every client re-walk the vault, so
   *  only a mutation that moved a row may say it. */
  function announceMutation(paths: readonly string[]): void {
    args.notifier.notifyVault(["files-changed"], paths);
    args.onMutated?.(paths);
  }

  /**
   * The one atomic write: tmp file + fsync + rename, then the announcement.
   * Callers hold the lock and have already validated the leaf.
   *
   * `created` is what separates the two announcements. Overwriting a file
   * changes its bytes and NOTHING a tree row carries, so a content-only write
   * says `content-changed` alone — it used to say both, and a `vault`
   * subscriber received one write as two events, which cost the open note two
   * reads and the workspace a full re-walk per keystroke's save.
   */
  async function performAtomicWrite(
    relPath: string,
    absPath: string,
    content: string,
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
    if (created) {
      args.notifier.notifyVault(["files-changed"], [relPath]);
    }
    args.onMutated?.([relPath]);
  }

  return {
    async listTree() {
      const entries: VaultEntry[] = [];
      await walk(rootReal, "", entries);
      // `basename` here rather than a split in the browser: this side is the
      // one that knows the machine's separator, and a root that is itself a
      // drive or mount point still has to be called something.
      return { root: rootReal, name: basename(rootReal) || rootReal, entries };
    },

    async statEntry(path) {
      let relPath: string;
      let absPath: string;
      try {
        ({ relPath, absPath } = resolveVaultPath(rootReal, path));
      } catch {
        // A path the vault refuses is not an entry, the same as a missing one.
        return null;
      }
      const stats = await lstat(absPath).catch(() => null);
      if (stats === null || stats.isSymbolicLink()) {
        return null;
      }
      // The listing hides ignored names; a stat must agree with it.
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

    async readBytes(path) {
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
      const buffer = await readFile(absPath).catch((cause: unknown) => {
        const code = errnoCode(cause);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw notFound(relPath);
        }
        throw cause;
      });
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      return {
        path: relPath,
        bytes: bytes.buffer,
        etag: `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`,
      };
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
          // The base the client hashed no longer exists at all.
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

/**
 * Remove staging files a crash left behind. Housekeeping rather than a
 * precondition: `git add` never stages one (the prefix is in the repo's own
 * `.git/info/exclude`) and both the listing and the watcher filter the same
 * names, so nothing downstream waits on this and boot need not either.
 *
 * `olderThan` is what makes running it beside live writes safe — a leftover is
 * by definition older than the process sweeping for it, so a candidate younger
 * than that timestamp is somebody's in-flight write and is left alone.
 */
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
