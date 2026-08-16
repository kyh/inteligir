// The host shell around the pure knowledge engine: core's SQL KnowledgeStore
// over better-sqlite3 mirrored into core's in-memory LinkGraphIndex, driven by
// the vault runtime's change announcements.
//
// PROJECTION IS DRIVEN BY ANNOUNCED PATHS. The vault service and the watcher
// both name the paths they touched, so a pass reads exactly those files —
// projectDoc once per changed doc, store write, graph mirror. A change with no
// paths (the consolidated post-sync notification) triggers a RECONCILE instead.
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

import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { LinkGraphIndex, type BacklinkEntry } from "@repo/notes/knowledge/link-graph-index";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { normalizePath } from "@repo/notes/knowledge/vault-path";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import type { VaultEntry } from "@repo/server-contract/vault";
import { VaultServiceError, type VaultService } from "../vault/vault-service";
import type { VaultFilesChange } from "../vault/vault-runtime";
import { createSqliteDriver } from "./sqlite-driver";

/** The index cache's own file, beside the app db — never inside it. */
const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

/** Change batches already arrive debounced (the watcher's 200ms window); this
 * only coalesces a service-write burst with its surroundings. */
const CHANGE_DEBOUNCE_MS = 100;

/** Docs per hydration page and per reconcile transaction — a latency bound on
 * one uninterrupted synchronous unit, not a throughput knob. */
const BATCH_DOCS = 200;

type ReconcileStats = { projected: number; removed: number; unchanged: number };

/** What the runtime reads — the vault service, which owns containment, the
 * ignore rules and the read cap. */
type KnowledgeVaultReader = Pick<VaultService, "listTree" | "read">;

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
  /** Flush pending work and wait for the index to be current. Never rejects —
   * an index failure recovers by rebuilding, not by failing the caller. */
  settle(): Promise<void>;
  search(params: { query: string; tag?: string; limit: number }): Promise<SearchResult[]>;
  backlinks(path: string): Promise<BacklinkEntry[]>;
  tags(): Promise<TagCount[]>;
  renameCandidates(from: string, to: string): Promise<string[]>;
  /** The last reconcile's exact work, for boot logging and the hash-diff
   * tests; null until the boot reconcile has run. */
  readonly lastReconcile: ReconcileStats | null;
  dispose(): Promise<void>;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

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
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  function enqueuePass(): Promise<void> {
    queue = queue.then(pass);
    return queue;
  }

  function scheduleDebounced(): void {
    if (disposed || debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void enqueuePass();
    }, CHANGE_DEBOUNCE_MS);
    debounceTimer.unref?.();
  }

  async function pass(): Promise<void> {
    if (disposed) return;
    try {
      if (!hydrated) await hydrateMirrors();
      if (needsReconcile) {
        // A reconcile subsumes every named path, so the pending set drains
        // into it rather than being processed twice.
        pendingPaths.clear();
        needsReconcile = false;
        lastReconcile = await reconcile();
      }
      if (pendingPaths.size > 0) {
        const paths = [...pendingPaths].toSorted();
        pendingPaths.clear();
        await applyChangedPaths(paths);
      }
    } catch (err) {
      // The store is a cache: any failure mid-pass recovers by dropping it and
      // rebuilding from the vault on the next pass.
      console.warn("[knowledge] pass failed — rebuilding the index:", messageOf(err));
      recover();
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
    if (others.has(path)) return;
    store.upsertOther(path);
    graph.setOther(path);
    others.add(path);
  }

  async function indexDocPath(
    path: string,
    updates: DocUpdate[],
  ): Promise<"projected" | "unchanged" | "gone"> {
    let content: string;
    try {
      content = (await args.vault.read(path)).content;
    } catch (err) {
      if (!(err instanceof VaultServiceError)) throw err;
      if (err.code === "too_large") {
        // Over the read cap: unsearchable, but the path stays in the
        // link-resolution universe like any non-doc file.
        hashes.delete(path);
        indexOther(path);
      } else {
        removeIndexed(path);
      }
      return "gone";
    }
    const hash = sha256Hex(content);
    if (hashes.get(path) === hash) return "unchanged";
    updates.push({ path, content, hash });
    if (updates.length >= BATCH_DOCS) {
      applyDocUpdates(updates.splice(0));
      await yieldTurn();
    }
    return "projected";
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

    const updates: DocUpdate[] = [];
    for (const path of files) {
      if (!isDocPath(path)) {
        indexOther(path);
        continue;
      }
      const verdict = await indexDocPath(path, updates);
      if (verdict === "projected") stats.projected += 1;
      if (verdict === "unchanged") stats.unchanged += 1;
    }
    applyDocUpdates(updates);
    return stats;
  }

  /** Apply a batch of announced paths: files re-index, directories re-index
   * their subtree, missing paths (and anything indexed beneath them) drop. */
  async function applyChangedPaths(paths: readonly string[]): Promise<void> {
    const { entries } = await args.vault.listTree();
    const kinds = new Map<string, VaultEntry["kind"]>();
    for (const entry of entries) kinds.set(entry.path, entry.kind);

    const updates: DocUpdate[] = [];
    for (const path of paths) {
      switch (kinds.get(path)) {
        case "file": {
          if (isDocPath(path)) await indexDocPath(path, updates);
          else indexOther(path);
          break;
        }
        case "dir": {
          const prefix = `${path}/`;
          for (const [entryPath, kind] of kinds) {
            if (kind !== "file" || !entryPath.startsWith(prefix)) continue;
            if (isDocPath(entryPath)) await indexDocPath(entryPath, updates);
            else indexOther(entryPath);
          }
          break;
        }
        case undefined: {
          const prefix = `${path}/`;
          removeIndexed(path);
          for (const indexed of [...hashes.keys(), ...others]) {
            if (indexed.startsWith(prefix)) removeIndexed(indexed);
          }
          break;
        }
      }
    }
    applyDocUpdates(updates);
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
      await settle();
      return searchVaultNotes(
        {
          search: (query, limit) => store.search(query, limit),
          notesWithTag: (tag) => graph.notesWithTag(tag),
        },
        { query: params.query, tag: params.tag, limit: params.limit },
      );
    },

    async backlinks(path) {
      await settle();
      return graph.backlinks(normalizePath(path));
    },

    async tags() {
      await settle();
      return graph.tags();
    },

    /**
     * The docs a `from` → `to` rename may have to rewrite — a SUPERSET of the
     * ones that actually change, computed with no reads at all: the moved doc
     * itself, every doc whose links resolve to `from` today (backlinks,
     * exactly), and every doc holding a link that would resolve to `to`
     * AFTERWARDS — the shadow population, which is why the answer is not just
     * backlinks. Only the renamed path changes, so a link whose resolution
     * moves must land on `to` — the post-rename resolver is the exact test.
     */
    async renameCandidates(from, to) {
      await settle();
      const fromPath = normalizePath(from);
      const toPath = normalizePath(to);
      const candidates = new Set<string>([fromPath]);
      for (const entry of graph.backlinks(fromPath)) candidates.add(entry.sourcePath);

      const targets = graph.wikiTargets();
      const postPathOf = (path: string): string => (path === fromPath ? toPath : path);
      const aliasEntries = targets.flatMap((target) =>
        (target.aliases ?? []).map((alias): readonly [string, string] => [
          alias,
          postPathOf(target.path),
        ]),
      );
      const postResolver = buildResolver(
        targets.map((target) => postPathOf(target.path)),
        aliasEntries,
      );

      for (const target of targets) {
        if (target.type !== "doc" || candidates.has(target.path)) continue;
        const sourcePost = postPathOf(target.path);
        for (const link of graph.forwardLinks(target.path)) {
          const hit =
            link.kind === "wiki"
              ? postResolver.resolveWiki(link.target)
              : postResolver.resolveMd(link.target, sourcePost);
          if (hit === toPath) {
            candidates.add(target.path);
            break;
          }
        }
      }
      return [...candidates];
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
      await queue.catch(() => {});
      store.dispose();
    },
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
