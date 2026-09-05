// announced paths are statted, never resolved through a listing of the whole
// vault; a change naming no paths is a reconcile — a hash diff over the listing.
// every query settles pending work first, which is why no `knowledge` ws change
// kind exists.

import { join } from "node:path";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import {
  LinkGraphIndex,
  type BacklinkEntry,
  type WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import { renameCandidates } from "@repo/notes/knowledge/rename-candidates";
import { tagInFamily } from "@repo/notes/knowledge/rename-tags";
import { relatedNotes, type RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import {
  bodyPrefilter,
  collectVaultMatches,
  type TextMatchOptions,
  type VaultMatches,
} from "@repo/notes/knowledge/text-matches";
import {
  findUnlinkedMentions,
  mentionNames,
  type UnlinkedMentions,
} from "@repo/notes/knowledge/unlinked-mentions";
import { normalizePath } from "@repo/notes/knowledge/vault-path";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { contentHashBytesHex, type VaultEntry } from "@repo/api/local/vault/vault-schema";
import { createCoalescingTimer } from "../coalescing-timer";
import { mapWithConcurrency } from "../concurrency";
import { VaultServiceError, type VaultService } from "../vault/vault-service";
import type { VaultFilesChange } from "../vault/vault-runtime";
import { messageOf } from "../error-message";
import { createSqliteDriver } from "./sqlite-driver";

const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

// the watcher already debounces at 200ms; this only coalesces a service-write burst.
const CHANGE_DEBOUNCE_MS = 100;

// a latency bound on one uninterrupted synchronous unit, not a throughput knob.
const BATCH_DOCS = 200;

const READ_CONCURRENCY = 8;

type ReconcileStats = { projected: number; removed: number; unchanged: number };

type KnowledgeVaultReader = Pick<
  VaultService,
  "listTree" | "statEntry" | "listFilesUnder" | "readBytes"
>;

export interface KnowledgeRuntimeArgs {
  dataDir: string;
  vault: KnowledgeVaultReader;
  vaultRoot: string;
}

export interface KnowledgeRuntime {
  noteVaultChange(change: VaultFilesChange): void;
  // a failed pass rebuilds before this resolves; rejects only if the rebuild failed too.
  settle(): Promise<void>;
  search(params: { query: string; tag?: string; limit: number }): Promise<SearchResult[]>;
  matches(params: {
    needle: string;
    options: TextMatchOptions;
    limit: number;
  }): Promise<VaultMatches>;
  backlinks(path: string): Promise<BacklinkEntry[]>;
  wikiTargets(): Promise<WikiTarget[]>;
  // notes naming this one in prose without a link, one row per note on its first mention
  unlinkedMentions(path: string, limit: number): Promise<UnlinkedMentions>;
  relatedNotes(path: string, limit: number): Promise<RelatedNoteEntry[]>;
  tags(): Promise<TagCount[]>;
  renameCandidates(from: string, to: string): Promise<string[]>;
  // every doc holding the tag or one nested under it, computed with no reads
  tagRenameCandidates(from: string): Promise<string[]>;
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
  const hashes = new Map<string, string>();
  const others = new Set<string>();

  let hydrated = false;
  let needsReconcile = true;
  let lastReconcile: ReconcileStats | null = null;

  const pendingPaths = new Set<string>();
  let disposed = false;

  // at most one pass runs and one is queued; later triggers fold into the queued one.
  let runningPass: Promise<void> | null = null;
  let queuedPass: Promise<void> | null = null;

  function enqueuePass(): Promise<void> {
    if (runningPass !== null) {
      queuedPass ??= runningPass
        .catch(() => {
          // runs regardless of how the running pass ended.
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

  const debounce = createCoalescingTimer(CHANGE_DEBOUNCE_MS, () => {
    enqueuePass().catch(() => {
      // already logged inside the pass; nothing to surface it to.
    });
  });

  async function pass(): Promise<void> {
    if (disposed) return;
    try {
      await passWork();
    } catch (err) {
      // rebuild before this pass resolves: a caller awaiting it must not read the nuked index as a success.
      console.warn("[knowledge] pass failed — rebuilding the index:", messageOf(err));
      recover();
      await passWork();
    }
  }

  async function passWork(): Promise<void> {
    if (!hydrated) await hydrateMirrors();
    if (needsReconcile) {
      pendingPaths.clear();
      needsReconcile = false;
      try {
        lastReconcile = await reconcile();
      } catch (err) {
        needsReconcile = true;
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

  // every sql-backed read goes through this; graph-only reads need no retry, settle() already rebuilt the graph.
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
        others.delete(update.path);
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
    // a path can change class (an oversized doc degrades to other and back);
    // a stale hash left behind would satisfy the reconcile diff forever.
    const wasDoc = hashes.delete(path);
    if (!wasDoc && others.has(path)) return;
    store.upsertOther(path);
    graph.setOther(path);
    others.add(path);
  }

  type FileVerdict =
    | { kind: "projected"; update: DocUpdate }
    | { kind: "unchanged" }
    | { kind: "other" }
    | { kind: "missing" };

  async function readFileVerdict(path: string): Promise<FileVerdict> {
    if (!isDocPath(path)) return { kind: "other" };
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = (await args.vault.readBytes(path)).bytes;
    } catch (err) {
      if (!(err instanceof VaultServiceError)) throw err;
      // over the read cap: unsearchable, but still in the link-resolution universe.
      return err.code === "too_large" ? { kind: "other" } : { kind: "missing" };
    }
    // hash the bytes and decode only what moved; the common verdict is unchanged.
    const hash = await contentHashBytesHex(bytes);
    if (hashes.get(path) === hash) return { kind: "unchanged" };
    return { kind: "projected", update: { path, content: utf8.decode(bytes), hash } };
  }

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

  async function applyChangedPaths(paths: readonly string[]): Promise<void> {
    const kinds = await mapWithConcurrency(paths, READ_CONCURRENCY, (path) =>
      args.vault.statEntry(path),
    );
    // one snapshot before any removal: re-reading the live maps per path walks the whole index per deletion.
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
    debounce.clear();
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
      debounce.arm();
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

    // the literal scan, off the fts index: fts5 cannot say where inside a line a hit sits
    async matches(params) {
      return readThroughIndex("matches", () =>
        collectVaultMatches(
          store.docTexts(bodyPrefilter(params.needle)),
          params.needle,
          params.options,
          params.limit,
        ),
      );
    },

    async backlinks(path) {
      await settle();
      return graph.backlinks(normalizePath(path));
    },

    // the literal scan again, over the stem and the aliases; a single ascii name lets the
    // store pre-narrow, several names read every doc
    async unlinkedMentions(path, limit) {
      const normalized = normalizePath(path);
      return readThroughIndex("unlinked mentions", () => {
        const target = graph.wikiTargets().find((candidate) => candidate.path === normalized);
        const names = mentionNames(normalized, target?.aliases ?? []);
        const exclude = new Set([
          normalized,
          ...graph.backlinks(normalized).map((backlink) => backlink.sourcePath),
        ]);
        const only = names.length === 1 ? names[0] : undefined;
        const docs = store.docTexts(only === undefined ? null : bodyPrefilter(only));
        return findUnlinkedMentions(docs, { names, exclude, limit });
      });
    },

    async wikiTargets() {
      await settle();
      return graph.wikiTargets();
    },

    // the ranked read: the probe runs once per title token and keeps only the score, so search's excerpts would be wasted.
    async relatedNotes(path, limit) {
      const normalized = normalizePath(path);
      return readThroughIndex("related notes", () =>
        relatedNotes(graph, (query, probe) => store.searchRanked(query, probe), normalized, {
          limit,
        }),
      );
    },

    async tags() {
      await settle();
      return graph.tags();
    },

    async renameCandidates(from, to) {
      await settle();
      return renameCandidates(graph, from, to);
    },

    async tagRenameCandidates(from) {
      await settle();
      const paths = new Set<string>();
      for (const { tag } of graph.tags()) {
        if (!tagInFamily(tag, from)) continue;
        for (const path of graph.notesWithTag(tag)) paths.add(path);
      }
      return [...paths].toSorted();
    },

    get lastReconcile() {
      return lastReconcile;
    },

    async dispose() {
      disposed = true;
      debounce.clear();
      await queuedPass?.catch(() => {});
      await runningPass?.catch(() => {});
      store.dispose();
    },
  };
}
