// ---------------------------------------------------------------------------
// What the agent did to `./vault`, noticed and reported.
//
// The container's vault is a COPY. The vault of record lives in the user's
// Durable Object and its bytes live in R2, so a file the agent's own `write`,
// `edit` or `bash` touched here means nothing until it has been reported and
// applied there. Nothing else in the image watches for that: pi's file tools
// are pi's, and the daemon deliberately does not wrap them (a custom edit tool
// would be a second implementation of something pi already does well, and
// `bash` would walk around it anyway). A filesystem watch is the one place that
// sees every writer.
//
// The whole module hangs off ONE map — what the daemon believes is on disk, and
// who put it there. It can believe that, rather than guess, because the
// container's filesystem starts empty on every wake: every file under the vault
// arrived through a push this daemon applied, or was written by the agent while
// this daemon was watching. Two things fall out of it:
//
//   • SELF-WRITES DO NOT COME BACK. Materializing the vault is itself a burst of
//     writes under the watched directory, and reporting those would hand the
//     object its own bytes back — at best noise, at worst a write loop. A push
//     records the mtime it produced, and an event whose file still carries that
//     mtime is ours. By path and mtime rather than by a time window, because a
//     push can arrive while a turn is running and a window would swallow
//     whatever the agent wrote inside it.
//   • A REMOVAL IS ONLY REPORTED FOR A FILE THAT WAS THERE. `fs.watch` raises
//     events for the watched directory itself, carrying its own basename as the
//     filename — which stats as "absent" and would otherwise be reported as the
//     deletion of a note nobody has.
//
// The watch is RECURSIVE, which a watch over a user's own notes folder could
// not afford: this directory is a scratch copy with exactly one writer, and it
// exists for the minutes a turn runs.
// ---------------------------------------------------------------------------

import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { bytesToBase64, type VaultOp } from "./protocol";

/** How long a burst of events settles before it is read. Long enough that a
 * multi-file `bash` invocation reports once, short enough that a single edit
 * reaches the object while the turn is still running. Exported because a test
 * over a real directory has to wait it out rather than guess at it. */
export const SETTLE_MS = 400;

/** Largest file reported back. Past this it is not a note, and the report route
 * has its own body ceiling that a single such file would blow through. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Base64 payload per report. The route accepts 8MB; staying well under it
 * keeps one oversized burst from failing wholesale. */
const MAX_REPORT_BYTES = 4 * 1024 * 1024;

/**
 * A file the daemon believes exists, and who wrote it last.
 *
 * `host` carries the mtime the daemon produced, which is what makes the event
 * it caused recognizable. `agent` carries none: the file has already been
 * reported as the agent's, and every further event on it is another edit.
 */
type FileState =
  | { readonly source: "host"; readonly mtimeMs: number }
  | { readonly source: "agent" };

/** Everything the daemon believes is under the vault right now. Absence from it
 * means "no such file", which is what makes a removal reportable. */
type Inventory = Map<string, FileState>;

export type VaultWatcher = {
  start(): void;
  stop(): void;
  /**
   * Record that the daemon just wrote or removed `relPath`. Reads the file's
   * live mtime rather than taking one on trust — the caller cannot get it
   * wrong, and a write it forgot to announce is a write that comes back as the
   * agent's.
   */
  noteSelfChange(relPath: string): Promise<void>;
  /**
   * The host replaced the whole directory: forget what was under it, and watch
   * the directory that exists now.
   *
   * Re-watching is the load-bearing half. `fs.watch` on Linux binds to an
   * INODE, and a `replaceAll` removes the directory and creates a new one — a
   * handle kept across that watches something nobody will ever write to again,
   * and every edit the agent makes for the rest of the boot goes unseen.
   */
  reset(): void;
};

export type VaultWatcherDeps = {
  readonly dir: string;
  /** Send one batch of operations. Awaited, so batches arrive in the order
   * they were observed. */
  readonly report: (ops: readonly VaultOp[]) => Promise<void>;
};

export function createVaultWatcher(deps: VaultWatcherDeps): VaultWatcher {
  const inventory: Inventory = new Map();
  const pending = new Set<string>();
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Flushes chain: two passes reading the same file concurrently could report
  // its two states in either order, and the object applies what arrives last.
  let tail: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      tail = tail.then(() => drain(deps, inventory, pending));
    }, SETTLE_MS);
  };

  const open = (): void => {
    if (watcher !== null) return;
    try {
      watcher = watch(deps.dir, { recursive: true, persistent: false }, (_event, filename) => {
        // A null filename means the platform coalesced an event it could not
        // attribute. There is nothing to look up, and guessing would mean
        // re-reading the whole tree on every such event.
        if (filename === null) return;
        const relPath = normalize(filename);
        if (relPath === null) return;
        pending.add(relPath);
        schedule();
      });
      watcher.on("error", (error) => {
        console.error("[vault] watch failed:", error);
      });
    } catch (error) {
      // Loud, because the degradation is silent otherwise: the agent would edit
      // notes all turn and none of it would reach the user's vault.
      console.error(
        `[vault] could not watch ${deps.dir} — agent edits will not be reported:`,
        error,
      );
    }
  };

  const close = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    watcher?.close();
    watcher = null;
  };

  return {
    start: open,
    stop: close,

    async noteSelfChange(relPath) {
      const stats = await stat(join(deps.dir, relPath)).catch(() => null);
      if (stats === null) inventory.delete(relPath);
      else inventory.set(relPath, { source: "host", mtimeMs: stats.mtimeMs });
    },

    reset() {
      // Closed FIRST: whatever the wipe queued is dropped rather than raced
      // against, and the new handle sees only what happens from here.
      close();
      inventory.clear();
      pending.clear();
      open();
    },
  };
}

async function drain(
  deps: VaultWatcherDeps,
  inventory: Inventory,
  pending: Set<string>,
): Promise<void> {
  const paths = [...pending].toSorted();
  pending.clear();

  let batch: VaultOp[] = [];
  let batchBytes = 0;
  const send = async (): Promise<void> => {
    if (batch.length === 0) return;
    const ops = batch;
    batch = [];
    batchBytes = 0;
    await deps.report(ops);
  };

  for (const path of paths) {
    const op = await classify(deps.dir, inventory, path);
    if (op === null) continue;
    const size = op.op === "upsert" ? op.bytesBase64.length : path.length;
    if (batchBytes + size > MAX_REPORT_BYTES) await send();
    batch.push(op);
    batchBytes += size;
  }
  await send();
}

/** What one changed path means, or `null` when it means nothing — the daemon's
 * own write, a directory, or a name that never held a file. */
async function classify(dir: string, inventory: Inventory, path: string): Promise<VaultOp | null> {
  const stats = await stat(join(dir, path)).catch(() => null);

  if (stats === null) {
    if (!inventory.delete(path)) return null;
    return { op: "remove", path };
  }
  // A new directory raises an event of its own; the files inside it raise
  // theirs, and those are the ones that carry bytes.
  if (!stats.isFile()) return null;

  const state = inventory.get(path);
  if (state?.source === "host" && state.mtimeMs === stats.mtimeMs) return null;

  if (stats.size > MAX_FILE_BYTES) {
    console.error(`[vault] ${path} is ${stats.size} bytes — too large to report, skipped`);
    return null;
  }
  const bytes = await readFile(join(dir, path)).catch(() => null);
  if (bytes === null) return null;
  inventory.set(path, { source: "agent" });
  return { op: "upsert", path, bytesBase64: bytesToBase64(bytes) };
}

/** A vault-relative POSIX path, or `null` for anything that would name a file
 * outside the directory being watched. */
function normalize(filename: string): string | null {
  const path = filename.split("\\").join("/");
  if (path === "" || path.startsWith("/")) return null;
  return path.split("/").includes("..") ? null : path;
}
