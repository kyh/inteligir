// announced paths are statted, never resolved through a listing of the whole
// vault; a change naming no paths is a reconcile — a hash diff over the listing.
// the scan behind every row runs in a worker; this thread reads the bytes and
// writes the rows.

import { setImmediate as yieldTurn } from "node:timers/promises";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { DocFingerprint } from "@repo/notes/knowledge/knowledge-store";
import type { LinkGraphIndex } from "@repo/notes/knowledge/link-graph-index";
import type { DocProjection } from "@repo/notes/knowledge/projection";
import type { DocSearchColumns } from "@repo/notes/knowledge/search-columns";
import { KnowledgeStoreError } from "@repo/notes/knowledge/sql-knowledge-store";
import type { SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { contentHashBytesHex } from "@repo/contract/local/vault/vault-schema";
import { mapWithConcurrency } from "../concurrency";
import type { DebugLog } from "../debug-log";
import { messageOf } from "../error-message";
import { BACKGROUND_READ_SLOTS } from "../vault/read-slots";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultListedFile, VaultService } from "../vault/vault-service";
import type { VaultFilesChange } from "../vault/vault-changes";
import { createDeferredReads } from "./deferred-reads";
import type { Projector } from "./projector";

// docs per step (a page of hydration, a round of reads handed to the worker), and so how far a
// pass runs past dispose().
const BATCH_DOCS = 200;

// a latency bound on one uninterrupted run of row writes, not a throughput knob: a batch of
// large docs commits and yields once a slice passes it.
const WRITE_SLICE_MS = 16;

// longer than any read a local disk answers, so a doc past it is on storage that fetches or wakes
const READ_DEADLINE_MS = 2000;

export interface ReconcileStats {
  // every file the listing named, docs and others alike
  listed: number;
  projected: number;
  removed: number;
  unchanged: number;
  // docs whose read had not answered by the deadline: each is indexed once it does
  deferred: number;
  listMs: number;
  // the reads, and the projections and row writes they feed
  readMs: number;
}

export type KnowledgeVaultReader = Pick<
  VaultService,
  "listFileStats" | "statFile" | "listDirs" | "readBytes"
>;

export interface IndexPassArgs {
  store: SqlKnowledgeStore;
  graph: LinkGraphIndex;
  projector: Pick<Projector, "project">;
  vault: KnowledgeVaultReader;
  // a read left running past its deadline landed, and a later pass should apply it
  onLanded: () => void;
  readDeadlineMs?: number | undefined;
  debugLog?: DebugLog | undefined;
}

export interface IndexPass {
  // rejects as the pass failed; a failure other than the store's own leaves the next run a
  // whole reconcile
  run: () => Promise<void>;
  invalidate: (change: VaultFilesChange) => void;
  // drops the index for a rebuild from the vault, after the store failed
  recover: () => void;
  readonly lastReconcile: ReconcileStats | null;
  // every folder of the vault as the last walk and the announced folder changes left them
  readonly dirs: ReadonlySet<string>;
  readonly disposed: boolean;
  // a doc read the deadline deferred has not landed in a pass yet, or a pass took it and has not
  // applied it, so the index may still gain a path, an id or a title it does not hold now
  readsOutstanding: () => boolean;
  dispose: () => void;
}

const utf8 = new TextDecoder();

// what the index holds for a path, beside its graph entry
type IndexedEntry =
  // `fingerprint`: the listing's stat when its bytes were read, which a reconcile skips by
  | { kind: "doc"; hash: string; fingerprint: DocFingerprint | null }
  | { kind: "other" }
  // a doc whose projection threw, indexed as an other carrying its bytes' hash, so an unchanged
  // doc is not re-projected by every reconcile, nor after a restart
  | { kind: "unprojectable"; hash: string };

const OTHER_ENTRY: IndexedEntry = { kind: "other" };

const entryHash = (entry: IndexedEntry | undefined): string | undefined =>
  entry === undefined || entry.kind === "other" ? undefined : entry.hash;

const assertUnhandledRead = (read: never): never => {
  throw new Error(`unhandled file read: ${JSON.stringify(read)}`);
};

// thrown at a step boundary so a pass stops within one step of dispose().
class PassDisposedError extends Error {
  constructor() {
    super("the knowledge runtime was disposed mid-pass");
    this.name = "PassDisposedError";
  }
}

// what a read found, judged against the index only when a pass applies it: a read left
// running past its deadline lands after the index may have moved.
type FileRead =
  // `fingerprint`: the stat taken before the read, never after, so a write between the two
  // leaves a pair the next reconcile reads again
  | {
      kind: "bytes";
      bytes: Uint8Array<ArrayBuffer>;
      hash: string;
      fingerprint: DocFingerprint | null;
    }
  | { kind: "other" }
  | { kind: "missing" }
  | { kind: "unreadable"; reason: string };

const OTHER: FileRead = { kind: "other" };

interface DocUpdate {
  path: string;
  content: string;
  hash: string;
  fingerprint: DocFingerprint | null;
}

interface ProjectedUpdate {
  path: string;
  hash: string;
  fingerprint: DocFingerprint | null;
  projection: DocProjection;
  search: DocSearchColumns;
}

const sameFingerprint = (a: DocFingerprint | null, b: DocFingerprint | null): boolean =>
  a !== null && b !== null && a.size === b.size && a.mtimeMs === b.mtimeMs;

const fingerprintOf = (file: VaultListedFile): DocFingerprint => ({
  mtimeMs: file.mtimeMs,
  size: file.size,
});

export const createIndexPass = (args: IndexPassArgs): IndexPass => {
  const { graph, projector, store } = args;
  const indexed = new Map<string, IndexedEntry>();

  let hydrated = false;
  let needsReconcile = true;
  let lastReconcile: ReconcileStats | null = null;

  const pendingPaths = new Set<string>();
  let disposed = false;
  // landed reads a pass has taken and not yet applied: the deferred reads no longer hold them,
  // and the graph does not hold them yet
  let landedInHand = 0;

  // the last stat the listing or an announced change gave each file, which a read takes as its
  // fingerprint, and the vault's folders
  const listedStats = new Map<string, DocFingerprint>();
  let dirs = new Set<string>();

  // a failed read is the vault's trouble, not the index's: the prior row stands and every pass
  // retries the path, since a permission fix announces nothing.
  const unreadable = new Set<string>();

  const assertLive = (): void => {
    if (disposed) {
      throw new PassDisposedError();
    }
  };

  const recover = (): void => {
    // the store is closed or closing; a reset would reopen the file behind dispose's back.
    if (disposed) {
      return;
    }
    graph.clear();
    indexed.clear();
    pendingPaths.clear();
    unreadable.clear();
    listedStats.clear();
    try {
      store.nuke();
    } catch (error) {
      console.error("[knowledge] index reset failed:", messageOf(error));
    }
    // the empty store needs no replay
    hydrated = true;
    needsReconcile = true;
  };

  const hydrateMirrors = async (): Promise<void> => {
    const cursor = store.hydrate(BATCH_DOCS);
    for (;;) {
      assertLive();
      const page = cursor.next();
      if (page.kind === "done") {
        break;
      }
      if (page.kind === "docs") {
        for (const row of page.docs) {
          graph.applyDoc(row.path, row.projection);
          graph.setStat(row.path, row.fingerprint);
          indexed.set(row.path, {
            fingerprint: row.fingerprint,
            hash: row.contentHash,
            kind: "doc",
          });
        }
      } else {
        for (const other of page.others) {
          graph.setOther(other.path);
          indexed.set(
            other.path,
            other.unprojectableHash === null
              ? OTHER_ENTRY
              : { hash: other.unprojectableHash, kind: "unprojectable" },
          );
        }
      }
      await yieldTurn();
    }
    hydrated = true;
  };

  const removeIndexed = (path: string): boolean => {
    if (!indexed.delete(path)) {
      return false;
    }
    store.remove(path);
    graph.remove(path);
    return true;
  };

  const indexOther = (path: string, unprojectableHash?: string): void => {
    const entry: IndexedEntry =
      unprojectableHash === undefined
        ? OTHER_ENTRY
        : { hash: unprojectableHash, kind: "unprojectable" };
    // every reconcile re-applies every other, so one already indexed writes nothing
    const current = indexed.get(path);
    if (current?.kind === entry.kind && entryHash(current) === entryHash(entry)) {
      return;
    }
    store.upsertOther(path, unprojectableHash);
    graph.setOther(path);
    indexed.set(path, entry);
  };

  // one transaction, closed once the slice budget runs out; answers how many docs it wrote
  const writeSlice = (docs: readonly ProjectedUpdate[]): number => {
    const began = performance.now();
    let written = 0;
    store.transaction(() => {
      for (const doc of docs) {
        store.upsertDoc(
          {
            contentHash: doc.hash,
            fingerprint: doc.fingerprint,
            path: doc.path,
            projection: doc.projection,
          },
          doc.search,
        );
        written += 1;
        if (performance.now() - began >= WRITE_SLICE_MS) {
          break;
        }
      }
    });
    for (const doc of docs.slice(0, written)) {
      graph.applyDoc(doc.path, doc.projection);
      indexed.set(doc.path, { fingerprint: doc.fingerprint, hash: doc.hash, kind: "doc" });
    }
    return written;
  };

  const writeDocRows = async (docs: readonly ProjectedUpdate[]): Promise<void> => {
    let pending = docs;
    while (pending.length > 0) {
      pending = pending.slice(writeSlice(pending));
      if (pending.length > 0) {
        await yieldTurn();
        assertLive();
      }
    }
  };

  // the worker projects one doc at a time: a doc the scan cannot take (a stack-deep nesting
  // overflows it) costs that doc its searchable row, never the batch.
  const applyDocUpdates = async (updates: readonly DocUpdate[]): Promise<void> => {
    if (updates.length === 0) {
      return;
    }
    const results = await projector.project(
      updates.map((update) => ({ content: update.content, path: update.path })),
    );
    assertLive();
    const projected: ProjectedUpdate[] = [];
    for (const [index, update] of updates.entries()) {
      const result = results[index];
      if (result === undefined) {
        continue;
      }
      if (result.kind === "projected") {
        projected.push({
          fingerprint: update.fingerprint,
          hash: update.hash,
          path: update.path,
          projection: result.projection,
          search: result.search,
        });
        continue;
      }
      console.warn(`[knowledge] cannot index ${update.path}: ${result.reason}`);
      indexOther(update.path, update.hash);
    }
    await writeDocRows(projected);
  };

  // total: a read left running has no pass to fail, so every outcome is an answer.
  const readDocFile = async (path: string): Promise<FileRead> => {
    const fingerprint = listedStats.get(path) ?? null;
    try {
      const { bytes } = await args.vault.readBytes(path, "background");
      return { bytes, fingerprint, hash: await contentHashBytesHex(bytes), kind: "bytes" };
    } catch (error) {
      if (!(error instanceof VaultServiceError)) {
        return { kind: "unreadable", reason: messageOf(error) };
      }
      // over the read cap: unsearchable, but still in the link-resolution universe.
      return error.code === "too_large" ? OTHER : { kind: "missing" };
    }
  };

  const docReads = createDeferredReads({
    deadlineMs: args.readDeadlineMs ?? READ_DEADLINE_MS,
    limit: BACKGROUND_READ_SLOTS,
    onLanded: args.onLanded,
    read: readDocFile,
  });

  // the same bytes under a stat that moved (a touch, a checkout): only the row's pair is rewritten,
  // so the next reconcile skips the doc again
  const keepFingerprint = (
    path: string,
    current: Extract<IndexedEntry, { kind: "doc" }>,
    fingerprint: DocFingerprint,
  ): void => {
    if (sameFingerprint(current.fingerprint, fingerprint)) {
      return;
    }
    store.setFingerprint(path, fingerprint);
    indexed.set(path, { ...current, fingerprint });
  };

  const applyRead = (
    path: string,
    read: FileRead,
    updates: DocUpdate[],
    stats?: ReconcileStats,
  ): void => {
    const wasUnreadable = unreadable.delete(path);
    switch (read.kind) {
      case "bytes": {
        // decode only what moved; the common answer is unchanged.
        const current = indexed.get(path);
        if (entryHash(current) === read.hash) {
          args.debugLog?.(`${path}: unchanged, skipped`);
          if (current?.kind === "doc" && read.fingerprint !== null) {
            keepFingerprint(path, current, read.fingerprint);
          }
          if (stats !== undefined) {
            stats.unchanged += 1;
          }
          break;
        }
        args.debugLog?.(`${path}: changed, indexing`);
        updates.push({
          content: utf8.decode(read.bytes),
          fingerprint: read.fingerprint,
          hash: read.hash,
          path,
        });
        if (stats !== undefined) {
          stats.projected += 1;
        }
        break;
      }
      case "other": {
        args.debugLog?.(`${path}: not a searchable doc, indexed as an other`);
        indexOther(path);
        break;
      }
      case "missing": {
        args.debugLog?.(`${path}: gone, removed`);
        removeIndexed(path);
        break;
      }
      case "unreadable": {
        args.debugLog?.(`${path}: unreadable, keeping its last entry (${read.reason})`);
        unreadable.add(path);
        if (!wasUnreadable) {
          console.warn(`[knowledge] cannot read ${path}, keeping its last entry: ${read.reason}`);
        }
        break;
      }
      default: {
        assertUnhandledRead(read);
      }
    }
  };

  const applyLanded = async (): Promise<void> => {
    const taken = docReads.takeLanded();
    if (taken.size === 0) {
      return;
    }
    landedInHand += 1;
    try {
      const updates: DocUpdate[] = [];
      for (const [path, read] of taken) {
        applyRead(path, read, updates);
      }
      await applyDocUpdates(updates);
    } finally {
      landedInHand -= 1;
    }
  };

  // a doc a reconcile lists under the stat its row was read at is not read again
  const unmovedDoc = (path: string): boolean => {
    const current = indexed.get(path);
    return (
      current?.kind === "doc" &&
      !unreadable.has(path) &&
      sameFingerprint(current.fingerprint, listedStats.get(path) ?? null)
    );
  };

  // a deferred doc keeps its last entry; its read lands in a later pass. `stats` is a
  // reconcile's, which skips the docs whose stat did not move.
  const projectFiles = async (paths: readonly string[], stats?: ReconcileStats): Promise<void> => {
    let deferred = 0;
    for (let start = 0; start < paths.length; start += BATCH_DOCS) {
      assertLive();
      const chunk = paths.slice(start, start + BATCH_DOCS);
      const docs = chunk.filter((path) => {
        if (!isDocPath(path)) {
          return false;
        }
        if (stats !== undefined && unmovedDoc(path)) {
          args.debugLog?.(`${path}: its size and mtime did not move, skipped`);
          stats.unchanged += 1;
          return false;
        }
        return true;
      });
      const reads = await docReads.readAll(docs);
      const updates: DocUpdate[] = [];
      for (const path of chunk) {
        if (!isDocPath(path)) {
          applyRead(path, OTHER, updates, stats);
        }
      }
      for (const [index, read] of reads.entries()) {
        const path = docs[index];
        if (path === undefined) {
          continue;
        }
        if (read === null) {
          args.debugLog?.(`${path}: no answer by the read deadline, deferred`);
          deferred += 1;
          continue;
        }
        applyRead(path, read, updates, stats);
      }
      await applyDocUpdates(updates);
      if (start + BATCH_DOCS < paths.length) {
        await yieldTurn();
      }
    }
    // a reconcile's own line counts them
    if (stats !== undefined) {
      stats.deferred += deferred;
    } else if (deferred > 0) {
      console.warn(
        `[knowledge] ${String(deferred)} doc(s) did not answer within the read deadline; each is indexed once it does`,
      );
    }
  };

  // the listing's stat for each file, into the library's sort and size and the reads' fingerprint
  const noteStats = (files: readonly VaultListedFile[]): void => {
    for (const file of files) {
      const fingerprint = fingerprintOf(file);
      listedStats.set(file.path, fingerprint);
      graph.setStat(file.path, fingerprint);
    }
  };

  const forgetDirsUnder = (path: string): void => {
    const prefix = `${path}/`;
    for (const dir of dirs) {
      if (dir === path || dir.startsWith(prefix)) {
        dirs.delete(dir);
      }
    }
  };

  const removeGone = (gone: readonly string[]): void => {
    if (gone.length === 0) {
      return;
    }
    // one snapshot, taken at the first folder: re-reading the live map per path walks the whole index per deletion.
    let snapshot: string[] | undefined;
    store.transaction(() => {
      for (const path of gone) {
        args.debugLog?.(`${path}: gone, removed with anything under it`);
        unreadable.delete(path);
        docReads.forget(path);
        listedStats.delete(path);
        forgetDirsUnder(path);
        // an indexed file has no indexed children, so only a folder pays for the prefix scan.
        if (removeIndexed(path)) {
          continue;
        }
        snapshot ??= [...indexed.keys()];
        const prefix = `${path}/`;
        for (const candidate of snapshot) {
          if (candidate.startsWith(prefix)) {
            removeIndexed(candidate);
            listedStats.delete(candidate);
          }
        }
      }
    });
  };

  const reconcile = async (): Promise<ReconcileStats> => {
    const began = performance.now();
    const listedFiles = await args.vault.listFileStats();
    // the folders from the same layout, before anything is read, so scopes never walks
    const listedDirs = await args.vault.listDirs();
    const listed = performance.now();
    const files = listedFiles.map((file) => file.path);
    const current = new Set(files);
    listedStats.clear();
    noteStats(listedFiles);
    dirs = new Set(listedDirs);
    const stats: ReconcileStats = {
      deferred: 0,
      listMs: listed - began,
      listed: files.length,
      projected: 0,
      readMs: 0,
      removed: 0,
      unchanged: 0,
    };

    const stale = [...indexed.keys()].filter((path) => !current.has(path));
    removeGone(stale);
    stats.removed = stale.length;

    await projectFiles(files, stats);
    stats.readMs = performance.now() - listed;
    return stats;
  };

  const applyChangedPaths = async (paths: readonly string[]): Promise<void> => {
    const kinds = await mapWithConcurrency(
      paths,
      BACKGROUND_READ_SLOTS,
      async (path) => await args.vault.statFile(path),
    );
    // a set: a folder's expansion repeats the file events announced beside it.
    const files = new Set<string>();
    const gone: string[] = [];
    for (const [index, stat] of kinds.entries()) {
      const path = paths[index];
      if (path === undefined) {
        continue;
      }
      if (stat?.kind === "file") {
        noteStats([{ mtimeMs: stat.mtimeMs, path, size: stat.size }]);
        files.add(path);
        continue;
      }
      if (stat?.kind === "dir") {
        args.debugLog?.(`${path}: a folder, indexing every file under it`);
        assertLive();
        dirs.add(path);
        for (const dir of await args.vault.listDirs(path)) {
          dirs.add(dir);
        }
        const under = await args.vault.listFileStats(path);
        noteStats(under);
        for (const file of under) {
          files.add(file.path);
        }
        continue;
      }
      gone.push(path);
    }
    removeGone(gone);
    await projectFiles([...files]);
  };

  const passWork = async (): Promise<void> => {
    if (!hydrated) {
      await hydrateMirrors();
    }
    // before anything read fresh, which supersedes it
    await applyLanded();
    for (const path of unreadable) {
      pendingPaths.add(path);
    }
    if (needsReconcile) {
      pendingPaths.clear();
      needsReconcile = false;
      try {
        lastReconcile = await reconcile();
      } catch (error) {
        needsReconcile = true;
        throw error;
      }
      console.log(
        `[knowledge] reconcile: projected ${lastReconcile.projected}, removed ${lastReconcile.removed}, unchanged ${lastReconcile.unchanged}, deferred ${lastReconcile.deferred}`,
      );
    }
    if (pendingPaths.size > 0) {
      const paths = [...pendingPaths].toSorted();
      pendingPaths.clear();
      await applyChangedPaths(paths);
    }
  };

  return {
    dispose() {
      disposed = true;
      // a read still out may never land, so nothing waits on one
      docReads.dispose();
    },

    get dirs() {
      return dirs;
    },

    get disposed() {
      return disposed;
    },

    readsOutstanding: () => landedInHand > 0 || docReads.outstanding(),

    invalidate(change) {
      if (change.kind === "paths") {
        for (const path of change.paths) {
          pendingPaths.add(path);
        }
      } else {
        needsReconcile = true;
      }
    },

    get lastReconcile() {
      return lastReconcile;
    },

    recover,

    async run() {
      try {
        await passWork();
      } catch (error) {
        // the next pass reconciles whole, since this one may have spent the paths it was handed;
        // a pass dispose() stopped has no next one, and a failed store is rebuilt whole.
        if (!disposed && !(error instanceof KnowledgeStoreError)) {
          console.warn("[knowledge] pass failed:", messageOf(error));
          needsReconcile = true;
        }
        throw error;
      }
    },
  };
};
