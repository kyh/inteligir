// every query settles pending work first, which is why no `knowledge` ws change
// kind exists, and a doc whose read has not answered by its deadline is left out
// of that settle until it lands.

import nodePath from "node:path";
import { COVERS_DIR, UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import type {
  ItemPage,
  ItemPaths,
  ItemQuery,
  ItemRow,
  ItemScopes,
  UrlMatches,
} from "@repo/notes/items/library-index";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { LinkGraphIndex } from "@repo/notes/knowledge/link-graph-index";
import type { BacklinkEntry, WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { moveCandidates } from "@repo/notes/knowledge/rename-candidates";
import { notesInTagFamily } from "@repo/notes/knowledge/tag-notes";
import { relatedNotes } from "@repo/notes/knowledge/related-notes";
import type { RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import type { SearchResult } from "@repo/notes/knowledge/search-query";
import {
  createSqlKnowledgeStore,
  KnowledgeStoreError,
} from "@repo/notes/knowledge/sql-knowledge-store";
import type { SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import { bodyPrefilters, collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import type { TextMatchOptions, VaultMatches } from "@repo/notes/knowledge/text-matches";
import { dirnamePath, normalizePath } from "@repo/notes/knowledge/vault-path";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { createCoalescingTimer } from "../coalescing-timer";
import type { DebugLog } from "../debug-log";
import type { VaultFilesChange } from "../vault/vault-changes";
import { messageOf } from "../error-message";
import { createIndexPass } from "./index-pass";
import type { KnowledgeVaultReader, ReconcileStats } from "./index-pass";
import type { RenameEditsJob, TagRenameEditsJob } from "./projection-protocol";
import type { Projector } from "./projector";
import { createSqliteDriver } from "./sqlite-driver";

const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

// the watcher already debounces at 200ms; this only coalesces a service-write burst.
const CHANGE_DEBOUNCE_MS = 100;

export interface KnowledgeRuntimeArgs {
  dataDir: string;
  vault: KnowledgeVaultReader;
  vaultRoot: string;
  // owned: dispose() disposes it first, so a pass mid-projection is released, not waited out
  projector: Projector;
  // a suite shortens it rather than stalling a read for seconds
  readDeadlineMs?: number;
  debugLog?: DebugLog | undefined;
  // the attachments pref's folder when it names one, which the rail's folder tree leaves out
  attachmentsFolder?: () => string | null;
  // told once after each pass that added, removed or renamed a path or moved a doc's aliases or
  // id: what the bus announces as `targets-changed`
  onTargetsChanged?: () => void;
}

export interface KnowledgeRuntime {
  invalidate: (change: VaultFilesChange) => void;
  // a pass the store failed rebuilds before this resolves, and rejects only if the rebuild failed
  // too; any other failure rejects and leaves the index standing. a doc whose read is still out
  // answers from its last entry meanwhile.
  settle: () => Promise<void>;
  search: (params: { query: string; tag?: string; limit: number }) => Promise<SearchResult[]>;
  matches: (params: {
    needle: string;
    options: TextMatchOptions;
    limit: number;
  }) => Promise<VaultMatches>;
  backlinks: (path: string) => Promise<BacklinkEntry[]>;
  wikiTargets: () => Promise<WikiTarget[]>;
  // every doc whose frontmatter `id` is this one, by path
  noteIdOwners: (id: string) => Promise<string[]>;
  // the doc whose frontmatter `id` this is: `lastPath` while it still is, else the id tier's own
  // pick; null when no indexed doc carries it
  pathForNoteId: (id: string, lastPath: string) => Promise<string | null>;
  relatedNotes: (path: string, limit: number) => Promise<RelatedNoteEntry[]>;
  tags: () => Promise<TagCount[]>;
  // the tag's family by path: a page of it and the whole count
  tagNotes: (
    tag: string,
    limit: number,
    offset: number,
  ) => Promise<{ paths: string[]; total: number }>;
  // pre-move path to post-move path: one entry for a note, one per file under a folder
  renameCandidates: (moves: ReadonlyMap<string, string>) => Promise<string[]>;
  // every doc holding the tag or one nested under it, computed with no reads
  tagRenameCandidates: (from: string) => Promise<string[]>;
  // the rewrite sets' byte surgery scans every candidate, so it runs where projection does
  renameEdits: (job: RenameEditsJob) => Promise<Map<string, string>>;
  tagRenameEdits: (job: TagRenameEditsJob) => Promise<Map<string, string>>;
  // the library listing, answered from the in-memory mirror: no sql read and no walk
  items: (q: ItemQuery) => Promise<ItemPage>;
  itemPaths: (q: ItemQuery) => Promise<ItemPaths>;
  // in request order; a path that is not an item is left out
  itemsAt: (paths: readonly string[]) => Promise<ItemRow[]>;
  findByUrl: (url: string, limit: number) => Promise<UrlMatches>;
  // the folders are the walk's own directory set, which a folder change refreshes
  scopes: () => Promise<ItemScopes>;
  // the stubs a fill may take, the earliest saved first: in-process only
  itemStubs: () => Promise<string[]>;
  // the files that are not docs this doc links or embeds, deduplicated in link order
  linkedFiles: (path: string) => Promise<string[]>;
  readonly lastReconcile: ReconcileStats | null;
  dispose: () => Promise<void>;
}

// what the rail's folder tree never lists: the attachments and covers folder, a chosen
// attachments folder, and Unsorted, which is a scope row of its own
const hiddenFoldersOf = (attachmentsFolder: string | null): string[] => [
  dirnamePath(COVERS_DIR),
  UNSORTED_FOLDER,
  ...(attachmentsFolder === null ? [] : [normalizePath(attachmentsFolder)]),
];

export const createKnowledgeRuntime = (args: KnowledgeRuntimeArgs): KnowledgeRuntime => {
  const store: SqlKnowledgeStore = createSqlKnowledgeStore(
    createSqliteDriver(nodePath.join(args.dataDir, KNOWLEDGE_DB_FILE_NAME)),
    args.vaultRoot,
  );
  if (store.opened.kind === "discarded") {
    console.warn("[knowledge] discarding the index db (will rebuild):", store.opened.reason);
  }
  const { projector } = args;
  const graph = new LinkGraphIndex();
  // at most one pass runs and one is queued; later triggers fold into the queued one.
  let runningPass: Promise<void> | null = null;
  let queuedPass: Promise<void> | null = null;

  const indexPass = createIndexPass({
    debugLog: args.debugLog,
    graph,
    onLanded: () => {
      // oxlint-disable-next-line no-use-before-define -- the debounce runs passes over this index, and a read lands only after a pass started it, so the debounce exists by then
      debounce.arm();
    },
    projector,
    readDeadlineMs: args.readDeadlineMs,
    store,
    vault: args.vault,
  });

  const announceTargets = (): void => {
    if (graph.takeTargetsChanged()) {
      args.onTargetsChanged?.();
    }
  };

  const pass = async (): Promise<void> => {
    if (indexPass.disposed) {
      return;
    }
    try {
      await indexPass.run();
      announceTargets();
    } catch (error) {
      // however it ended: dispose() stops the worker under a pass mid-projection, and nothing is
      // rebuilt for a runtime that is going away.
      if (indexPass.disposed) {
        return;
      }
      if (!(error instanceof KnowledgeStoreError)) {
        throw error;
      }
      // rebuild before this pass resolves: a caller awaiting it must not read the nuked index as a success.
      console.warn("[knowledge] the index store failed — rebuilding it:", messageOf(error));
      indexPass.recover();
      await indexPass.run();
      announceTargets();
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
      if (!(error instanceof KnowledgeStoreError)) {
        throw error;
      }
      console.warn(`[knowledge] ${what} failed — rebuilding the index:`, messageOf(error));
      indexPass.recover();
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
      indexPass.dispose();
      debounce.clear();
      await projector.dispose();
      try {
        await queuedPass;
        await runningPass;
      } catch {
        // a failed pass already logged; disposal still closes the store.
      }
      store.dispose();
    },

    invalidate(change) {
      if (indexPass.disposed) {
        return;
      }
      indexPass.invalidate(change);
      debounce.arm();
    },

    async findByUrl(url, limit) {
      await settle();
      return graph.findByUrl(url, limit);
    },

    async itemPaths(q) {
      await settle();
      return graph.itemPaths(q);
    },

    async items(q) {
      await settle();
      return graph.items(q);
    },

    async itemsAt(paths) {
      await settle();
      return graph.itemsAt(paths.map(normalizePath));
    },

    async itemStubs() {
      await settle();
      return graph.itemStubs();
    },

    get lastReconcile() {
      return indexPass.lastReconcile;
    },

    async linkedFiles(path) {
      await settle();
      const targets = graph
        .forwardLinks(normalizePath(path))
        .flatMap(({ targetPath }) =>
          targetPath === null || isDocPath(targetPath) ? [] : [targetPath],
        );
      return [...new Set(targets)];
    },

    // the literal scan, off the fts index: fts5 cannot say where inside a line a hit sits
    async matches(params) {
      return await readThroughIndex("matches", () =>
        collectVaultMatches(
          store.docTexts(bodyPrefilters([params.needle])),
          params.needle,
          params.options,
          params.limit,
        ),
      );
    },

    async noteIdOwners(id) {
      await settle();
      return graph.pathsWithNoteId(id);
    },

    async pathForNoteId(id, lastPath) {
      await settle();
      return graph.pathForNoteId(id, normalizePath(lastPath));
    },

    // the ranked read: the probe runs once per title token and keeps only the score, so search's excerpts would be wasted.
    async relatedNotes(path, limit) {
      const normalized = normalizePath(path);
      return await readThroughIndex("related notes", () =>
        relatedNotes(
          graph,
          (query, probe, options) => store.searchRanked(query, probe, options),
          normalized,
          { limit },
        ),
      );
    },

    async renameCandidates(moves) {
      await settle();
      return moveCandidates(graph, moves);
    },

    renameEdits: projector.renameEdits,

    async scopes() {
      await settle();
      return graph.scopes([...indexPass.dirs], hiddenFoldersOf(args.attachmentsFolder?.() ?? null));
    },

    async search(params) {
      return await readThroughIndex("search", () =>
        searchVaultNotes(
          {
            notesInTag: (tag) => notesInTagFamily(graph, tag),
            search: (query, limit) => store.search(query, limit),
            titleOf: (path) => graph.titleOf(path),
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

    tagRenameEdits: projector.tagRenameEdits,

    async tags() {
      await settle();
      return graph.tags();
    },

    async wikiTargets() {
      await settle();
      return graph.wikiTargets();
    },
  };
};
