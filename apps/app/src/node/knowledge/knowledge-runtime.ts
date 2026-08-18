// The host shell around the pure knowledge engine: core's SQL KnowledgeStore
// over better-sqlite3 mirrored into core's in-memory LinkGraphIndex, driven by
// the vault runtime's change announcements.
//
// PROJECTION IS DRIVEN BY ANNOUNCED PATHS. The vault service and the watcher
// both name the paths they touched, so a pass reads exactly those files —
// projectDoc once per changed doc, store write, graph mirror. What each
// announced path IS comes from a stat of THAT path, never from a listing of
// the whole vault: only an announced DIRECTORY costs a walk, and only of its
// own subtree. A change with no paths (the consolidated post-sync
// notification) triggers a RECONCILE instead.
//
// RECONCILE IS A HASH DIFF, and it is the boot path: walk the vault's listing,
// hash each doc's bytes, and re-project only where the hash disagrees with what
// the projection recorded — exact, and free when nothing moved. A projection
// version bump empties the store on open (its own guard), so the same diff IS
// the full rebuild; there is no second machinery.
//
// EVERY QUERY SETTLES FIRST: pending work (including the debounce window) is
// flushed before search/backlinks/tags answer, so a caller that heard the
// vault's files-changed and asked immediately still sees the change indexed.
// That is also why no `knowledge` ws change kind exists — the existing vault
// invalidation plus settle-on-query keeps every consumer current.

import { join } from "node:path";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { LinkGraphIndex, type BacklinkEntry } from "@repo/notes/knowledge/link-graph-index";
import { renameCandidates } from "@repo/notes/knowledge/rename-candidates";
import { relatedNotes, type RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { normalizePath } from "@repo/notes/knowledge/vault-path";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { contentHashBytesHex, type VaultEntry } from "@repo/server-contract/vault";
import { mapWithConcurrency } from "../concurrency";
import { VaultServiceError, type VaultService } from "../vault/vault-service";
import type { VaultFilesChange } from "../vault/vault-runtime";
import { messageOf } from "./message-of";
import { createSqliteDriver } from "./sqlite-driver";

/** The index cache's own file, beside the app db — never inside it. */
const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

/** Change batches already arrive debounced (the watcher's 200ms window); this
 * only coalesces a service-write burst with its surroundings. */
const CHANGE_DEBOUNCE_MS = 100;

/** Docs per hydration page and per reconcile transaction — a latency bound on
 * one uninterrupted synchronous unit, not a throughput knob. */
const BATCH_DOCS = 200;

/** Reads in flight while a batch is gathered. The apply stays synchronous and
 * batched; this only stops a cold reconcile from paying one file's latency at
 * a time, without handing the filesystem an unbounded fan-out. */
const READ_CONCURRENCY = 8;

type ReconcileStats = { projected: number; removed: number; unchanged: number };

/** What the runtime reads — the vault service, which owns containment, the
 * ignore rules and the read cap. */
type KnowledgeVaultReader = Pick<
  VaultService,
  "listTree" | "statEntry" | "listFilesUnder" | "readBytes"
>;

export interface KnowledgeRuntimeArgs {
  /** The app's data dir; the index file lives at its root. */
  dataDir: string;
  vault: KnowledgeVaultReader;
  /** The configured vault root — the store's moved-vault guard. */
  vaultRoot: string;
}

export interface KnowledgeRuntime {
  /** The vault runtime's change hook. Named paths queue a targeted pass; a
   * change that names none queues a reconcile. */
  noteVaultChange(change: VaultFilesChange): void;
  /** Flush pending work and wait for the index to be current. An index
   * failure recovers by nuking and rebuilding BEFORE this resolves; it
   * rejects only when even that rebuild failed — never resolving over a
   * silently emptied index. */
  settle(): Promise<void>;
  search(params: { query: string; tag?: string; limit: number }): Promise<SearchResult[]>;
  backlinks(path: string): Promise<BacklinkEntry[]>;
  relatedNotes(path: string, limit: number): Promise<RelatedNoteEntry[]>;
  tags(): Promise<TagCount[]>;
  renameCandidates(from: string, to: string): Promise<string[]>;
  /** The last reconcile's exact work, for boot logging and the hash-diff
   * tests; null until the boot reconcile has run. */
  readonly lastReconcile: ReconcileStats | null;
  dispose(): Promise<void>;
}

const utf8 = new TextDecoder();

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function createKnowledgeRuntime(args: KnowledgeRuntimeArgs): KnowledgeRuntime {
  const store: SqlKnowledgeStore = createSqlKnowledgeStore(
    createSqliteDriver(join(args.dataDir, KNOWLEDGE_DB_FILE_NAME)),
    args.vaultRoot,
  );
  const graph = new LinkGraphIndex();
  /** Recorded content hash per indexed doc — the reconcile's diff basis. */
  const hashes = new Map<string, string>();
  /** Indexed non-doc paths (link-resolution universe only). */
  const others = new Set<string>();

  let hydrated = false;
  let needsReconcile = true;
  let lastReconcile: ReconcileStats | null = null;

  const pendingPaths = new Set<string>();
  let debounceTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  // Pass scheduling is COALESCED: at most one pass runs and at most one more
  // is queued behind it. Triggers arriving while one is queued fold into it
  // (the pending set and the flags are the dirty state a pass consumes), so a
  // burst of queries can never build an unbounded chain of no-op passes.
  let runningPass: Promise<void> | null = null;
  let queuedPass: Promise<void> | null = null;

  function enqueuePass(): Promise<void> {
    if (runningPass !== null) {
      queuedPass ??= runningPass
        .catch(() => {
          // The queued pass runs regardless of how the running one ended.
        })
        .then(() => {
          queuedPass = null;
          return enqueuePass();
        });
      return queuedPass;
    }
    const run = pass().finally(() => {
      if (runningPass === run) runningPass = null;
    });
    runningPass = run;
    return run;
  }

  function scheduleDebounced(): void {
    if (disposed || debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      enqueuePass().catch(() => {
        // Already logged inside the pass; a background trigger has no caller
        // to surface the rebuild failure to.
      });
    }, CHANGE_DEBOUNCE_MS);
    debounceTimer.unref?.();
  }

  async function pass(): Promise<void> {
    if (disposed) return;
    try {
      await passWork();
    } catch (err) {
      // The store is a cache: drop it and rebuild from the vault — but BEFORE
      // this pass resolves, because a caller awaiting it must never read the
      // just-nuked index as a success. A rebuild that itself fails surfaces
      // as this pass's rejection: a failed query beats an empty-index answer.
      console.warn("[knowledge] pass failed — rebuilding the index:", messageOf(err));
      recover();
      await passWork();
    }
  }

  async function passWork(): Promise<void> {
    if (!hydrated) await hydrateMirrors();
    if (needsReconcile) {
      // A reconcile subsumes every named path, so the pending set drains
      // into it rather than being processed twice.
      pendingPaths.clear();
      needsReconcile = false;
      try {
        lastReconcile = await reconcile();
      } catch (err) {
        needsReconcile = true; // the mark survives the failure
        throw err;
      }
      console.log(
        `[knowledge] reconcile: projected ${lastReconcile.projected}, removed ${lastReconcile.removed}, unchanged ${lastReconcile.unchanged}`,
      );
    }
    if (pendingPaths.size > 0) {
      const paths = [...pendingPaths].toSorted();
      pendingPaths.clear();
      await applyChangedPaths(paths);
    }
  }

  /** Settle, then run a read that goes through the SQL store: a corrupt-read
   * rejection gets one nuke-and-rebuild, then one retry. A second failure
   * propagates. Shared by every SQL-backed read, so adding one cannot quietly
   * arrive without the recovery — the graph-only reads need none, because a
   * rebuilt graph is what `settle()` already guarantees. */
  async function readThroughIndex<T>(what: string, run: () => T): Promise<T> {
    await settle();
    try {
      return run();
    } catch (err) {
      console.warn(`[knowledge] ${what} failed — rebuilding the index:`, messageOf(err));
      recover();
      await settle();
      return run();
    }
  }

  function recover(): void {
    graph.clear();
    hashes.clear();
    others.clear();
    pendingPaths.clear();
    try {
      store.nuke();
    } catch (err) {
      console.error("[knowledge] index reset failed:", messageOf(err));
    }
    hydrated = true; // the empty store needs no replay
    needsReconcile = true;
  }

  /** Replay the persisted projection into the in-memory mirrors, one bounded
   * page at a time with a yield between. */
  async function hydrateMirrors(): Promise<void> {
    const cursor = store.hydrate(BATCH_DOCS);
    for (;;) {
      const page = cursor.next();
      if (page.kind === "done") break;
      if (page.kind === "docs") {
        for (const row of page.docs) {
          graph.applyDoc(row.path, row.projection);
          hashes.set(row.path, row.contentHash);
        }
      } else {
        for (const other of page.others) {
          graph.setOther(other.path);
          others.add(other.path);
        }
      }
      await yieldTurn();
    }
    hydrated = true;
  }

  /** A doc's projected write, gathered async and applied in one transaction. */
  type DocUpdate = { path: string; content: string; hash: string };

  function applyDocUpdates(updates: readonly DocUpdate[]): void {
    if (updates.length === 0) return;
    store.transaction(() => {
      for (const update of updates) {
        const projection = projectDoc(update.path, update.content);
        store.upsertDoc(
          { path: update.path, contentHash: update.hash, projection },
          update.content,
        );
        graph.applyDoc(update.path, projection);
        others.delete(update.path); // the class-transition twin of indexOther
        hashes.set(update.path, update.hash);
      }
    });
  }

  function removeIndexed(path: string): boolean {
    const known = hashes.delete(path) || others.delete(path);
    if (!known) return false;
    store.remove(path);
    graph.remove(path);
    return true;
  }

  function indexOther(path: string): void {
    // A path can CHANGE class (an oversized doc degrades to "other" and back),
    // so entering one class always leaves the doc bookkeeping — otherwise a
    // stale hash would satisfy the reconcile diff forever.
    const wasDoc = hashes.delete(path);
    if (!wasDoc && others.has(path)) return;
    store.upsertOther(path);
    graph.setOther(path);
    others.add(path);
  }

  /** What ONE file path needs, read but not yet applied — the async half of
   * a batch, so a chunk's reads can run concurrently while the apply below
   * stays one ordered synchronous transaction. */
  type FileVerdict =
    | { kind: "projected"; update: DocUpdate }
    | { kind: "unchanged" }
    | { kind: "other" }
    | { kind: "missing" };

  async function readFileVerdict(path: string): Promise<FileVerdict> {
    if (!isDocPath(path)) return { kind: "other" };
    let bytes: ArrayBuffer;
    try {
      bytes = (await args.vault.readBytes(path)).bytes;
    } catch (err) {
      if (!(err instanceof VaultServiceError)) throw err;
      // Over the read cap: unsearchable, but the path stays in the
      // link-resolution universe like any non-doc file.
      return err.code === "too_large" ? { kind: "other" } : { kind: "missing" };
    }
    // Hash the BYTES and decode only what actually moved. The reconcile's
    // common verdict is `unchanged`, and a decode-then-re-encode is two passes
    // over a file it is about to decide it does not need.
    const hash = await contentHashBytesHex(bytes);
    if (hashes.get(path) === hash) return { kind: "unchanged" };
    return { kind: "projected", update: { path, content: utf8.decode(bytes), hash } };
  }

  /** Read a batch of file paths with bounded concurrency and apply each
   * chunk's verdicts in one transaction, in input order. */
  async function projectFiles(paths: readonly string[], stats?: ReconcileStats): Promise<void> {
    for (let start = 0; start < paths.length; start += BATCH_DOCS) {
      const chunk = paths.slice(start, start + BATCH_DOCS);
      const verdicts = await mapWithConcurrency(chunk, READ_CONCURRENCY, readFileVerdict);
      const updates: DocUpdate[] = [];
      for (const [index, verdict] of verdicts.entries()) {
        const path = chunk[index];
        if (path === undefined) continue;
        switch (verdict.kind) {
          case "projected":
            updates.push(verdict.update);
            if (stats !== undefined) stats.projected += 1;
            break;
          case "unchanged":
            if (stats !== undefined) stats.unchanged += 1;
            break;
          case "other":
            indexOther(path);
            break;
          case "missing":
            removeIndexed(path);
            break;
        }
      }
      applyDocUpdates(updates);
      if (start + BATCH_DOCS < paths.length) await yieldTurn();
    }
  }

  async function listFiles(): Promise<string[]> {
    const { entries } = await args.vault.listTree();
    return entries.filter((entry: VaultEntry) => entry.kind === "file").map((entry) => entry.path);
  }

  /** Diff the vault's current files against what each projection recorded. */
  async function reconcile(): Promise<ReconcileStats> {
    const files = await listFiles();
    const current = new Set(files);
    const stats: ReconcileStats = { projected: 0, removed: 0, unchanged: 0 };

    for (const path of [...hashes.keys(), ...others]) {
      if (current.has(path)) continue;
      removeIndexed(path);
      stats.removed += 1;
    }

    await projectFiles(files, stats);
    return stats;
  }

  /** Apply a batch of announced paths: files re-index, directories re-index
   * their own subtree, missing paths (and anything indexed beneath them)
   * drop. Each announced path is STATTED — a listing of the whole vault is
   * the reconcile's job, not a per-batch cost. */
  async function applyChangedPaths(paths: readonly string[]): Promise<void> {
    const kinds = await mapWithConcurrency(paths, READ_CONCURRENCY, (path) =>
      args.vault.statEntry(path),
    );
    // ONE snapshot of what is indexed, taken before any removal: a missing
    // path drops its own subtree, and re-reading the live maps per path would
    // walk the whole index again for every announced deletion.
    const indexedSnapshot: string[] = kinds.includes(null) ? [...hashes.keys(), ...others] : [];

    const files: string[] = [];
    for (const [index, kind] of kinds.entries()) {
      const path = paths[index];
      if (path === undefined) continue;
      if (kind === "file") {
        files.push(path);
        continue;
      }
      if (kind === "dir") {
        files.push(...(await args.vault.listFilesUnder(path)));
        continue;
      }
      const prefix = `${path}/`;
      removeIndexed(path);
      for (const indexed of indexedSnapshot) {
        if (indexed.startsWith(prefix)) removeIndexed(indexed);
      }
    }
    await projectFiles(files);
  }

  function settle(): Promise<void> {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return enqueuePass();
  }

  return {
    noteVaultChange(change) {
      if (disposed) return;
      if (change.kind === "paths") {
        for (const path of change.paths) pendingPaths.add(path);
      } else {
        needsReconcile = true;
      }
      scheduleDebounced();
    },

    settle,

    async search(params) {
      return readThroughIndex("search", () =>
        searchVaultNotes(
          {
            search: (query, limit) => store.search(query, limit),
            notesWithTag: (tag) => graph.notesWithTag(tag),
          },
          { query: params.query, tag: params.tag, limit: params.limit },
        ),
      );
    },

    async backlinks(path) {
      await settle();
      return graph.backlinks(normalizePath(path));
    },

    // The ranking is the engine's (related-notes.ts); this shell supplies its
    // graph and points its lexical port at the same FTS5 `search` uses, which
    // is why it reads THROUGH the index rather than off the graph alone.
    async relatedNotes(path, limit) {
      const normalized = normalizePath(path);
      return readThroughIndex("related notes", () =>
        relatedNotes(graph, (query, probe) => store.search(query, probe), normalized, { limit }),
      );
    },

    async tags() {
      await settle();
      return graph.tags();
    },

    // The selection policy is the engine's (rename-candidates.ts, beside the
    // byte surgery it feeds); this shell only supplies its graph.
    async renameCandidates(from, to) {
      await settle();
      return renameCandidates(graph, from, to);
    },

    get lastReconcile() {
      return lastReconcile;
    },

    async dispose() {
      disposed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      await queuedPass?.catch(() => {});
      await runningPass?.catch(() => {});
      store.dispose();
    },
  };
}
