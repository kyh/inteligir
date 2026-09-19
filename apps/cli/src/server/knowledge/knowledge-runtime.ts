// announced paths are statted, never resolved through a listing of the whole
// vault; a change naming no paths is a reconcile — a hash diff over the listing.
// every query settles pending work first, which is why no `knowledge` ws change
// kind exists.

import nodePath from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { LinkGraphIndex } from "@repo/notes/knowledge/link-graph-index";
import type { BacklinkEntry, WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { renameCandidates } from "@repo/notes/knowledge/rename-candidates";
import { notesInTagFamily } from "@repo/notes/knowledge/tag-notes";
import { relatedNotes } from "@repo/notes/knowledge/related-notes";
import type { RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import type { SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { bodyPrefilter, collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import type { TextMatchOptions, VaultMatches } from "@repo/notes/knowledge/text-matches";
import { findUnlinkedMentions, mentionNames } from "@repo/notes/knowledge/unlinked-mentions";
import type { UnlinkedMentions } from "@repo/notes/knowledge/unlinked-mentions";
import { collectVaultProblems } from "@repo/notes/knowledge/vault-problems";
import type { VaultProblems, VaultProblemsOptions } from "@repo/notes/knowledge/vault-problems";
import { normalizePath } from "@repo/notes/knowledge/vault-path";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { contentHashBytesHex } from "@repo/api/local/vault/vault-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { createCoalescingTimer } from "../coalescing-timer";
import { mapWithConcurrency } from "../concurrency";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";
import type { VaultFilesChange } from "../vault/vault-runtime";
import { messageOf } from "../error-message";
import { createSqliteDriver } from "./sqlite-driver";

const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

// the watcher already debounces at 200ms; this only coalesces a service-write burst.
const CHANGE_DEBOUNCE_MS = 100;

// a latency bound on one uninterrupted synchronous unit, not a throughput knob.
const BATCH_DOCS = 200;

const READ_CONCURRENCY = 8;

interface ReconcileStats {
  projected: number;
  removed: number;
  unchanged: number;
}

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
  noteVaultChange: (change: VaultFilesChange) => void;
  // a failed pass rebuilds before this resolves; rejects only if the rebuild failed too.
  settle: () => Promise<void>;
  search: (params: { query: string; tag?: string; limit: number }) => Promise<SearchResult[]>;
  matches: (params: {
    needle: string;
    options: TextMatchOptions;
    limit: number;
  }) => Promise<VaultMatches>;
  backlinks: (path: string) => Promise<BacklinkEntry[]>;
  wikiTargets: () => Promise<WikiTarget[]>;
  // notes naming this one in prose without a link, one row per note on its first mention
  unlinkedMentions: (path: string, limit: number) => Promise<UnlinkedMentions>;
  // what the resolver cannot answer, from the index alone
  problems: (options: VaultProblemsOptions) => Promise<VaultProblems>;
  relatedNotes: (path: string, limit: number) => Promise<RelatedNoteEntry[]>;
  tags: () => Promise<TagCount[]>;
  // the tag's family by path: a page of it and the whole count
  tagNotes: (
    tag: string,
    limit: number,
    offset: number,
  ) => Promise<{ paths: string[]; total: number }>;
  renameCandidates: (from: string, to: string) => Promise<string[]>;
  // every doc holding the tag or one nested under it, computed with no reads
  tagRenameCandidates: (from: string) => Promise<string[]>;
  readonly lastReconcile: ReconcileStats | null;
  dispose: () => Promise<void>;
}

const utf8 = new TextDecoder();

const assertUnhandledVerdict = (verdict: never): never => {
  throw new Error(`unhandled file verdict: ${JSON.stringify(verdict)}`);
};

export const createKnowledgeRuntime = (args: KnowledgeRuntimeArgs): KnowledgeRuntime => {
  const store: SqlKnowledgeStore = createSqlKnowledgeStore(
    createSqliteDriver(nodePath.join(args.dataDir, KNOWLEDGE_DB_FILE_NAME)),
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

  const recover = (): void => {
    graph.clear();
    hashes.clear();
    others.clear();
    pendingPaths.clear();
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
      const page = cursor.next();
      if (page.kind === "done") {
        break;
      }
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
  };

  interface DocUpdate {
    path: string;
    content: string;
    hash: string;
  }

  const applyDocUpdates = (updates: readonly DocUpdate[]): void => {
    if (updates.length === 0) {
      return;
    }
    store.transaction(() => {
      for (const update of updates) {
        const projection = projectDoc(update.path, update.content);
        store.upsertDoc(
          { contentHash: update.hash, path: update.path, projection },
          update.content,
        );
        graph.applyDoc(update.path, projection);
        others.delete(update.path);
        hashes.set(update.path, update.hash);
      }
    });
  };

  const removeIndexed = (path: string): boolean => {
    const known = hashes.delete(path) || others.delete(path);
    if (!known) {
      return false;
    }
    store.remove(path);
    graph.remove(path);
    return true;
  };

  const indexOther = (path: string): void => {
    // a path can change class (an oversized doc degrades to other and back);
    // a stale hash left behind would satisfy the reconcile diff forever.
    const wasDoc = hashes.delete(path);
    if (!wasDoc && others.has(path)) {
      return;
    }
    store.upsertOther(path);
    graph.setOther(path);
    others.add(path);
  };

  type FileVerdict =
    | { kind: "projected"; update: DocUpdate }
    | { kind: "unchanged" }
    | { kind: "other" }
    | { kind: "missing" };

  const readFileVerdict = async (path: string): Promise<FileVerdict> => {
    if (!isDocPath(path)) {
      return { kind: "other" };
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      ({ bytes } = await args.vault.readBytes(path));
    } catch (error) {
      if (!(error instanceof VaultServiceError)) {
        throw error;
      }
      // over the read cap: unsearchable, but still in the link-resolution universe.
      return error.code === "too_large" ? { kind: "other" } : { kind: "missing" };
    }
    // hash the bytes and decode only what moved; the common verdict is unchanged.
    const hash = await contentHashBytesHex(bytes);
    if (hashes.get(path) === hash) {
      return { kind: "unchanged" };
    }
    return { kind: "projected", update: { content: utf8.decode(bytes), hash, path } };
  };

  const projectFiles = async (paths: readonly string[], stats?: ReconcileStats): Promise<void> => {
    for (let start = 0; start < paths.length; start += BATCH_DOCS) {
      const chunk = paths.slice(start, start + BATCH_DOCS);
      const verdicts = await mapWithConcurrency(chunk, READ_CONCURRENCY, readFileVerdict);
      const updates: DocUpdate[] = [];
      for (const [index, verdict] of verdicts.entries()) {
        const path = chunk[index];
        if (path === undefined) {
          continue;
        }
        switch (verdict.kind) {
          case "projected": {
            updates.push(verdict.update);
            if (stats !== undefined) {
              stats.projected += 1;
            }
            break;
          }
          case "unchanged": {
            if (stats !== undefined) {
              stats.unchanged += 1;
            }
            break;
          }
          case "other": {
            indexOther(path);
            break;
          }
          case "missing": {
            removeIndexed(path);
            break;
          }
          default: {
            assertUnhandledVerdict(verdict);
          }
        }
      }
      applyDocUpdates(updates);
      if (start + BATCH_DOCS < paths.length) {
        await yieldTurn();
      }
    }
  };

  const listFiles = async (): Promise<string[]> => {
    const { entries } = await args.vault.listTree();
    return entries.filter((entry: VaultEntry) => entry.kind === "file").map((entry) => entry.path);
  };

  const reconcile = async (): Promise<ReconcileStats> => {
    const files = await listFiles();
    const current = new Set(files);
    const stats: ReconcileStats = { projected: 0, removed: 0, unchanged: 0 };

    for (const path of [...hashes.keys(), ...others]) {
      if (current.has(path)) {
        continue;
      }
      removeIndexed(path);
      stats.removed += 1;
    }

    await projectFiles(files, stats);
    return stats;
  };

  const applyChangedPaths = async (paths: readonly string[]): Promise<void> => {
    const kinds = await mapWithConcurrency(
      paths,
      READ_CONCURRENCY,
      async (path) => await args.vault.statEntry(path),
    );
    // one snapshot before any removal: re-reading the live maps per path walks the whole index per deletion.
    const indexedSnapshot: string[] = kinds.includes(null) ? [...hashes.keys(), ...others] : [];

    const files: string[] = [];
    for (const [index, kind] of kinds.entries()) {
      const path = paths[index];
      if (path === undefined) {
        continue;
      }
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
        if (indexed.startsWith(prefix)) {
          removeIndexed(indexed);
        }
      }
    }
    await projectFiles(files);
  };

  const passWork = async (): Promise<void> => {
    if (!hydrated) {
      await hydrateMirrors();
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
        `[knowledge] reconcile: projected ${lastReconcile.projected}, removed ${lastReconcile.removed}, unchanged ${lastReconcile.unchanged}`,
      );
    }
    if (pendingPaths.size > 0) {
      const paths = [...pendingPaths].toSorted();
      pendingPaths.clear();
      await applyChangedPaths(paths);
    }
  };

  const pass = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    try {
      await passWork();
    } catch (error) {
      // rebuild before this pass resolves: a caller awaiting it must not read the nuked index as a success.
      console.warn("[knowledge] pass failed — rebuilding the index:", messageOf(error));
      recover();
      await passWork();
    }
  };

  const enqueuePass = async (): Promise<void> => {
    if (runningPass !== null) {
      const current = runningPass;
      queuedPass ??= (async () => {
        try {
          await current;
        } catch {
          // runs regardless of how the running pass ended.
        }
        queuedPass = null;
        await enqueuePass();
      })();
      await queuedPass;
      return;
    }
    const run = pass();
    runningPass = run;
    try {
      await run;
    } finally {
      if (runningPass === run) {
        runningPass = null;
      }
    }
  };

  const enqueuePassQuietly = async (): Promise<void> => {
    try {
      await enqueuePass();
    } catch {
      // already logged inside the pass; nothing to surface it to.
    }
  };

  const debounce = createCoalescingTimer(CHANGE_DEBOUNCE_MS, () => {
    void enqueuePassQuietly();
  });

  const settle = async (): Promise<void> => {
    debounce.clear();
    await enqueuePass();
  };

  // every sql-backed read goes through this; graph-only reads need no retry, settle() already rebuilt the graph.
  const readThroughIndex = async <T>(what: string, run: () => T): Promise<T> => {
    await settle();
    try {
      return run();
    } catch (error) {
      console.warn(`[knowledge] ${what} failed — rebuilding the index:`, messageOf(error));
      recover();
      await settle();
      return run();
    }
  };

  return {
    async backlinks(path) {
      await settle();
      return graph.backlinks(normalizePath(path));
    },

    async dispose() {
      disposed = true;
      debounce.clear();
      try {
        await queuedPass;
        await runningPass;
      } catch {
        // a failed pass already logged; disposal still closes the store.
      }
      store.dispose();
    },

    get lastReconcile() {
      return lastReconcile;
    },

    // the literal scan, off the fts index: fts5 cannot say where inside a line a hit sits
    async matches(params) {
      return await readThroughIndex("matches", () =>
        collectVaultMatches(
          store.docTexts(bodyPrefilter(params.needle)),
          params.needle,
          params.options,
          params.limit,
        ),
      );
    },

    noteVaultChange(change) {
      if (disposed) {
        return;
      }
      if (change.kind === "paths") {
        for (const path of change.paths) {
          pendingPaths.add(path);
        }
      } else {
        needsReconcile = true;
      }
      debounce.arm();
    },

    async problems(options) {
      return await readThroughIndex("problems", () => collectVaultProblems(graph, options));
    },

    // the ranked read: the probe runs once per title token and keeps only the score, so search's excerpts would be wasted.
    async relatedNotes(path, limit) {
      const normalized = normalizePath(path);
      return await readThroughIndex("related notes", () =>
        relatedNotes(graph, (query, probe) => store.searchRanked(query, probe), normalized, {
          limit,
        }),
      );
    },

    async renameCandidates(from, to) {
      await settle();
      return renameCandidates(graph, from, to);
    },

    async search(params) {
      return await readThroughIndex("search", () =>
        searchVaultNotes(
          {
            notesWithTag: (tag) => graph.notesWithTag(tag),
            search: (query, limit) => store.search(query, limit),
          },
          { limit: params.limit, query: params.query, tag: params.tag },
        ),
      );
    },

    settle,

    async tagNotes(tag, limit, offset) {
      await settle();
      const all = notesInTagFamily(graph, tag);
      return { paths: all.slice(offset, offset + limit), total: all.length };
    },

    async tagRenameCandidates(from) {
      await settle();
      return notesInTagFamily(graph, from);
    },

    async tags() {
      await settle();
      return graph.tags();
    },

    // the literal scan again, over the stem and the aliases; a single ascii name lets the
    // store pre-narrow, several names read every doc
    async unlinkedMentions(path, limit) {
      const normalized = normalizePath(path);
      return await readThroughIndex("unlinked mentions", () => {
        const target = graph.wikiTargets().find((candidate) => candidate.path === normalized);
        const names = mentionNames(normalized, target?.aliases ?? []);
        const exclude = new Set([
          normalized,
          ...graph.backlinks(normalized).map((backlink) => backlink.sourcePath),
        ]);
        const only = names.length === 1 ? names[0] : undefined;
        const docs = store.docTexts(only === undefined ? null : bodyPrefilter(only));
        return findUnlinkedMentions(docs, { exclude, limit, names });
      });
    },

    async wikiTargets() {
      await settle();
      return graph.wikiTargets();
    },
  };
};
