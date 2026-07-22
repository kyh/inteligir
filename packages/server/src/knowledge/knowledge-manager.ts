// ---------------------------------------------------------------------------
// KnowledgeManager — the host shell around the pure knowledge engine: an
// injected persistent KnowledgeStore (SQLite projection cache) mirrored into
// core's in-memory LinkGraphIndex, kept fresh from vault change notifications,
// broadcasting onKnowledgeUpdated after every effective pass.
//
// Boot model: the first use HYDRATES synchronously from persisted projection
// rows (one store read, zero parses) so queries answer instantly with
// last-run data, then an async reconcile pass streams in whatever changed on
// disk. Reconcile diffs the vault's stat snapshot against recorded
// fingerprints; a changed file is re-read and content-hashed, and only a
// changed HASH re-projects and re-writes — a provider-wide mtime rewrite
// updates fingerprints without any projection/FTS churn. Passes are
// serialized on a queue (SyncEngine's idiom), chunked by a time budget with
// event-loop yields so a first-ever full build never stalls the process, and
// gated by a generation counter so a root switch/dispose aborts stale work.
//
// Any store failure is recovered by nuking the DB and rebuilding from the
// vault — always safe, the store is a cache (see knowledge-store.ts).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { SEARCH_DEFAULT_LIMIT, type SearchResult } from "@repo/notes/knowledge/knowledge-index";
import {
  LinkGraphIndex,
  type BacklinkEntry,
  type ForwardLinkEntry,
  type LinkGraph,
  type PrivacyOpts,
  type VaultTaskEntry,
  type WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import {
  relatedNotes,
  type RelatedNoteEntry,
  type RelatedNotesOpts,
} from "@repo/notes/knowledge/related-notes";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import type { KnowledgeStore, StoredFingerprint } from "@repo/notes/knowledge/knowledge-store";
import { projectDoc, type DocProjection } from "@repo/notes/knowledge/projection";

import { emitEvent } from "../events";
import { getVaultManager, type VaultManager } from "@repo/vault/vault";
import { createSqliteKnowledgeStore, indexDbPathFor } from "./sqlite-knowledge-store";

const REFRESH_DEBOUNCE_MS = 100;
/** Per-batch read+parse budget; the pass yields to the event loop between
 * batches so even a first-ever 5k-note build runs in short slices. */
const BATCH_BUDGET_MS = 15;
/** During a long pass, progress broadcasts are throttled to this interval so
 * a full rebuild doesn't hammer the renderer with per-batch re-queries. */
const PROGRESS_EMIT_MS = 250;

type ParsedChange =
  | {
      kind: "doc";
      path: string;
      fingerprint: StoredFingerprint;
      hash: string;
      projection: DocProjection;
      content: string;
    }
  | { kind: "fingerprint"; path: string; fingerprint: StoredFingerprint };

export class KnowledgeManager {
  private readonly linkGraph = new LinkGraphIndex();
  /** (mtime, size, ino) per indexed doc — the incremental-refresh diff basis,
   * mirroring the store's persisted fingerprints. */
  private readonly fingerprints = new Map<string, StoredFingerprint>();
  /** Content hash per indexed doc — the write authority above fingerprints. */
  private readonly hashes = new Map<string, string>();
  private readonly otherPaths = new Set<string>();
  private store: KnowledgeStore | null = null;
  private builtRoot: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  /** Bumped on root switch / recovery / dispose: an in-flight pass checks it
   * at every yield and aborts when the world moved on under it. */
  private generation = 0;
  /** Serialized pass queue — two passes never overlap (SyncEngine's idiom). */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly getVault: () => VaultManager,
    private readonly onUpdated: (revision: number) => void,
    private readonly openStore: (root: string) => KnowledgeStore,
  ) {}

  // ---- Queries (hydrate lazily on first use; reconcile streams in async) ------

  backlinks(vaultPath: string, opts?: PrivacyOpts): BacklinkEntry[] {
    this.ensureBuilt();
    return this.linkGraph.backlinks(vaultPath, opts);
  }

  forwardLinks(vaultPath: string): ForwardLinkEntry[] {
    this.ensureBuilt();
    return this.linkGraph.forwardLinks(vaultPath);
  }

  graph(): LinkGraph {
    this.ensureBuilt();
    return this.linkGraph.graph();
  }

  search(query: string, limit?: number, opts?: PrivacyOpts): SearchResult[] {
    this.ensureBuilt();
    const store = this.store;
    if (store === null) return [];
    try {
      return store.search(query, limit ?? SEARCH_DEFAULT_LIMIT, opts);
    } catch (err) {
      console.warn("[knowledge] search failed — rebuilding index db:", err);
      this.recover(store);
      void this.enqueuePass();
      return [];
    }
  }

  wikiTargets(): WikiTarget[] {
    this.ensureBuilt();
    return this.linkGraph.wikiTargets();
  }

  tags(): TagCount[] {
    this.ensureBuilt();
    return this.linkGraph.tags();
  }

  tasks(): VaultTaskEntry[] {
    this.ensureBuilt();
    return this.linkGraph.tasks();
  }

  notesWithTag(tag: string, opts?: PrivacyOpts): string[] {
    this.ensureBuilt();
    return this.linkGraph.notesWithTag(tag, opts);
  }

  /** Ranked related notes (shared links, co-citation, shared tags, lexical
   * similarity). The pure scorer reads the in-memory graph; its lexical
   * signal is THIS shell's composition seam — the SQL store's FTS5 bm25
   * through the same recovery-wrapped `search` the palette uses (the scorer
   * max-normalizes, so bm25's scale never matters). */
  relatedNotes(vaultPath: string, opts?: RelatedNotesOpts): RelatedNoteEntry[] {
    this.ensureBuilt();
    return relatedNotes(
      this.linkGraph,
      (query, limit) => this.search(query, limit),
      vaultPath,
      opts,
    );
  }

  /** Indexed private note paths — the agent gate's best-effort prefilter for
   * bash/execute strings and directory scans. Index-lagged (~100ms debounce);
   * anything that matters probes live disk on top. */
  privatePaths(): string[] {
    this.ensureBuilt();
    return this.linkGraph.privatePaths();
  }

  // ---- Refresh ----------------------------------------------------------------

  /** Debounced refresh — wired to vault change notifications. */
  scheduleRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueuePass();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Queue a reconcile pass; resolves when that pass completes. */
  refresh(): Promise<void> {
    return this.enqueuePass();
  }

  /** Resolves when every currently queued pass has completed (tests). */
  refreshDone(): Promise<void> {
    return this.queue;
  }

  /** Cancel pending work and release the store (shutdown). */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.generation++;
    this.store?.dispose();
    this.store = null;
    this.builtRoot = null;
  }

  // ---- Internals ----------------------------------------------------------------

  private ensureBuilt(): void {
    if (this.builtRoot !== null) return;
    // Hydration is synchronous — queries answer instantly with last-run data;
    // the queued reconcile streams in disk changes via onKnowledgeUpdated.
    this.bindRoot(this.getVault().getRoot());
    void this.enqueuePass();
  }

  /** Open (or reopen) the store for `root` and hydrate the in-memory mirrors
   * from its persisted rows — one SQL read, zero parses. */
  private bindRoot(root: string): void {
    this.generation++;
    this.store?.dispose();
    this.store = null;
    this.clearMirrors();
    const store = this.openStore(root);
    this.store = store;
    this.builtRoot = root;
    try {
      const { docs, others } = store.loadAll();
      for (const row of docs) {
        this.linkGraph.applyDoc(row.path, row.projection);
        this.fingerprints.set(row.path, row.fingerprint);
        this.hashes.set(row.path, row.contentHash);
      }
      for (const other of others) {
        this.linkGraph.setOther(other.path);
        this.otherPaths.add(other.path);
      }
    } catch (err) {
      console.warn("[knowledge] hydration failed — rebuilding index db:", err);
      this.recover(store);
    }
  }

  private clearMirrors(): void {
    this.linkGraph.clear();
    this.fingerprints.clear();
    this.hashes.clear();
    this.otherPaths.clear();
  }

  /** Nuke the store and drop the mirrors — the next pass rebuilds everything
   * from the vault. Safe by the cache law; bumps the generation so any
   * in-flight pass aborts rather than writing stale batches. */
  private recover(store: KnowledgeStore): void {
    this.generation++;
    this.clearMirrors();
    try {
      store.nuke();
    } catch (err) {
      console.warn("[knowledge] index db rebuild failed:", err);
    }
  }

  private enqueuePass(): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await this.runPass();
      } catch (err) {
        console.warn("[knowledge] refresh failed — rebuilding index db:", err);
        const store = this.store;
        if (store === null) return;
        this.recover(store);
        try {
          await this.runPass(); // full rebuild over the fresh store
        } catch (retryErr) {
          console.warn("[knowledge] rebuild pass failed:", retryErr);
        }
      }
    };
    this.queue = this.queue.then(run);
    return this.queue;
  }

  /** One reconcile pass: diff the vault stat snapshot against fingerprints,
   * re-project changed docs in time-budgeted batches (one store transaction
   * per batch), mirror removals, and broadcast when anything changed. */
  private async runPass(): Promise<void> {
    const vault = this.getVault();
    const root = vault.getRoot();
    let changed = false;
    if (root !== this.builtRoot || this.store === null) {
      this.bindRoot(root);
      changed = true;
    }
    const store = this.store;
    if (store === null) return;
    const generation = this.generation;

    const seen = new Set<string>();
    const work: Array<{ path: string; fingerprint: StoredFingerprint }> = [];
    const newOthers: string[] = [];
    for (const entry of vault.listWithStats()) {
      seen.add(entry.path);
      if (entry.kind !== "doc") {
        if (!this.otherPaths.has(entry.path)) {
          this.otherPaths.add(entry.path);
          this.linkGraph.setOther(entry.path);
          newOthers.push(entry.path);
          changed = true;
        }
        continue;
      }
      const fingerprint = { mtimeMs: entry.mtimeMs, size: entry.size, ino: entry.ino };
      const prior = this.fingerprints.get(entry.path);
      if (
        prior &&
        prior.mtimeMs === fingerprint.mtimeMs &&
        prior.size === fingerprint.size &&
        prior.ino === fingerprint.ino
      ) {
        continue;
      }
      work.push({ path: entry.path, fingerprint });
    }

    const removals: string[] = [];
    for (const known of this.fingerprints.keys()) {
      if (seen.has(known)) continue;
      this.fingerprints.delete(known);
      this.hashes.delete(known);
      this.linkGraph.remove(known);
      removals.push(known);
      changed = true;
    }
    for (const known of this.otherPaths) {
      if (seen.has(known)) continue;
      this.otherPaths.delete(known);
      this.linkGraph.remove(known);
      removals.push(known);
      changed = true;
    }
    // One transaction for the whole diff phase (mirroring the doc batches
    // below) instead of an implicit fsync'd txn per upsert/remove. Coarser
    // atomicity is safe — the store is a wipe-and-rebuild cache. The two sets
    // are disjoint (newOthers are listed paths, removals vanished ones).
    if (newOthers.length > 0 || removals.length > 0) {
      store.transaction(() => {
        for (const path of newOthers) store.upsertOther(path);
        for (const path of removals) store.remove(path);
      });
    }

    // Changed docs, in time-budgeted batches with event-loop yields between.
    let lastEmit = Date.now();
    let index = 0;
    while (index < work.length) {
      const batchStart = Date.now();
      const parsed: ParsedChange[] = [];
      while (index < work.length && Date.now() - batchStart < BATCH_BUDGET_MS) {
        const item = work[index];
        index++;
        if (item === undefined) break;
        let content: string;
        try {
          content = vault.readText(item.path);
        } catch (err) {
          console.warn(`[knowledge] could not read ${item.path}:`, err);
          continue; // no fingerprint recorded — retried next pass
        }
        const hash = sha256(content);
        if (this.hashes.get(item.path) === hash) {
          // Content identical (an mtime rewrite, e.g. a sync provider sweep):
          // persist the new fingerprint so future boots stay quiet, but skip
          // the projection/FTS churn entirely.
          parsed.push({ kind: "fingerprint", path: item.path, fingerprint: item.fingerprint });
          continue;
        }
        try {
          parsed.push({
            kind: "doc",
            path: item.path,
            fingerprint: item.fingerprint,
            hash,
            projection: projectDoc(item.path, content),
            content,
          });
        } catch (err) {
          console.warn(`[knowledge] could not index ${item.path}:`, err);
        }
      }

      if (parsed.length > 0) {
        store.transaction(() => {
          for (const change of parsed) {
            if (change.kind === "fingerprint") {
              store.updateFingerprint(change.path, change.fingerprint);
            } else {
              store.upsertDoc(
                {
                  path: change.path,
                  fingerprint: change.fingerprint,
                  contentHash: change.hash,
                  projection: change.projection,
                },
                change.content,
              );
            }
          }
        });
        for (const change of parsed) {
          this.fingerprints.set(change.path, change.fingerprint);
          if (change.kind === "doc") {
            this.hashes.set(change.path, change.hash);
            this.linkGraph.applyDoc(change.path, change.projection);
            changed = true;
          }
        }
      }

      if (index < work.length) {
        if (changed && Date.now() - lastEmit >= PROGRESS_EMIT_MS) {
          lastEmit = Date.now();
          this.revision++;
          this.onUpdated(this.revision);
        }
        await yieldToEventLoop();
        // The world may have moved on during the yield (root switch, recovery,
        // dispose): abandon this pass — the owner queued its own.
        if (this.generation !== generation || this.store !== store) return;
      }
    }

    if (changed) {
      this.revision++;
      this.onUpdated(this.revision);
    }
  }
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors getVaultManager(). The vault manager is looked up
// per refresh (not captured) so a logout/login vault reset is picked up
// transparently; a root switch is detected inside the pass. The store lives
// per vault root under ~/.inteligir/indexes/ (see sqlite-knowledge-store.ts).
// ---------------------------------------------------------------------------

let instance: KnowledgeManager | null = null;

export function getKnowledgeManager(): KnowledgeManager {
  if (!instance) {
    instance = new KnowledgeManager(
      getVaultManager,
      (revision) => emitEvent("onKnowledgeUpdated", { revision }),
      (root) => createSqliteKnowledgeStore(indexDbPathFor(root), root),
    );
  }
  return instance;
}

/** Cancel pending work and release the store at host dispose. */
export function disposeKnowledgeManager(): void {
  instance?.dispose();
  instance = null;
}
