// announced paths are statted, never resolved through a listing of the whole
// vault; a change naming no paths is a reconcile — a hash diff over the listing.
// every query settles pending work first, which is why no `knowledge` ws change
// kind exists. the scan behind every row runs in a worker; this thread reads the
// bytes and writes the rows.

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
import type { DocProjection } from "@repo/notes/knowledge/projection";
import type { DocSearchColumns } from "@repo/notes/knowledge/search-columns";
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
import type { VaultFilesChange } from "../vault/vault-changes";
import { messageOf } from "../error-message";
import type { RenameEditsJob, TagRenameEditsJob } from "./projection-protocol";
import type { Projector } from "./projector";
import { createSqliteDriver } from "./sqlite-driver";

const KNOWLEDGE_DB_FILE_NAME = "knowledge.db";

// the watcher already debounces at 200ms; this only coalesces a service-write burst.
const CHANGE_DEBOUNCE_MS = 100;

// docs per step (a page of hydration, a round of reads handed to the worker), and so how far a
// pass runs past dispose().
const BATCH_DOCS = 200;

// a latency bound on one uninterrupted run of row writes, not a throughput knob: a batch of
// large docs commits and yields once a slice passes it.
const WRITE_SLICE_MS = 16;

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
  // owned: dispose() disposes it first, so a pass mid-projection is released, not waited out
  projector: Projector;
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
  // every doc whose frontmatter `id` is this one, by path
  noteIdOwners: (id: string) => Promise<string[]>;
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
  // the rewrite sets' byte surgery scans every candidate, so it runs where projection does
  renameEdits: (job: RenameEditsJob) => Promise<Map<string, string>>;
  tagRenameEdits: (job: TagRenameEditsJob) => Promise<Map<string, string>>;
  readonly lastReconcile: ReconcileStats | null;
  dispose: () => Promise<void>;
}

const utf8 = new TextDecoder();

const assertUnhandledVerdict = (verdict: never): never => {
  throw new Error(`unhandled file verdict: ${JSON.stringify(verdict)}`);
};

// thrown at a step boundary so a pass stops within one step of dispose().
class PassDisposedError extends Error {
  constructor() {
    super("the knowledge runtime was disposed mid-pass");
    this.name = "PassDisposedError";
  }
}

export const createKnowledgeRuntime = (args: KnowledgeRuntimeArgs): KnowledgeRuntime => {
  const store: SqlKnowledgeStore = createSqlKnowledgeStore(
    createSqliteDriver(nodePath.join(args.dataDir, KNOWLEDGE_DB_FILE_NAME)),
    args.vaultRoot,
  );
  const { projector } = args;
  const graph = new LinkGraphIndex();
  const hashes = new Map<string, string>();
  const others = new Set<string>();

  let hydrated = false;
  let needsReconcile = true;
  let lastReconcile: ReconcileStats | null = null;

  const pendingPaths = new Set<string>();
  let disposed = false;

  // a failed read is the vault's trouble, not the index's: the prior row stands and every pass
  // retries the path, since a permission fix announces nothing.
  const unreadable = new Set<string>();
  // the hash of bytes whose projection threw, so an unchanged doc is not re-projected by every
  // reconcile; the path is indexed as an other meanwhile.
  const unprojectable = new Map<string, string>();

  // at most one pass runs and one is queued; later triggers fold into the queued one.
  let runningPass: Promise<void> | null = null;
  let queuedPass: Promise<void> | null = null;

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
    hashes.clear();
    others.clear();
    pendingPaths.clear();
    unreadable.clear();
    unprojectable.clear();
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

  const removeIndexed = (path: string): boolean => {
    unprojectable.delete(path);
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

  interface ProjectedUpdate {
    path: string;
    hash: string;
    projection: DocProjection;
    search: DocSearchColumns;
  }

  // one transaction, closed once the slice budget runs out; answers how many docs it wrote
  const writeSlice = (docs: readonly ProjectedUpdate[]): number => {
    const began = performance.now();
    let written = 0;
    store.transaction(() => {
      for (const doc of docs) {
        store.upsertDoc(
          { contentHash: doc.hash, path: doc.path, projection: doc.projection },
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
      others.delete(doc.path);
      hashes.set(doc.path, doc.hash);
      unprojectable.delete(doc.path);
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
          hash: update.hash,
          path: update.path,
          projection: result.projection,
          search: result.search,
        });
        continue;
      }
      console.warn(`[knowledge] cannot index ${update.path}: ${result.reason}`);
      indexOther(update.path);
      unprojectable.set(update.path, update.hash);
    }
    await writeDocRows(projected);
  };

  type FileVerdict =
    | { kind: "projected"; update: DocUpdate }
    | { kind: "unchanged" }
    | { kind: "other" }
    | { kind: "missing" }
    | { kind: "unreadable"; reason: string };

  const readFileVerdict = async (path: string): Promise<FileVerdict> => {
    if (!isDocPath(path)) {
      return { kind: "other" };
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      ({ bytes } = await args.vault.readBytes(path));
    } catch (error) {
      if (!(error instanceof VaultServiceError)) {
        return { kind: "unreadable", reason: messageOf(error) };
      }
      // over the read cap: unsearchable, but still in the link-resolution universe.
      return error.code === "too_large" ? { kind: "other" } : { kind: "missing" };
    }
    // hash the bytes and decode only what moved; the common verdict is unchanged.
    const hash = await contentHashBytesHex(bytes);
    if (hashes.get(path) === hash || unprojectable.get(path) === hash) {
      return { kind: "unchanged" };
    }
    return { kind: "projected", update: { content: utf8.decode(bytes), hash, path } };
  };

  const projectFiles = async (paths: readonly string[], stats?: ReconcileStats): Promise<void> => {
    for (let start = 0; start < paths.length; start += BATCH_DOCS) {
      assertLive();
      const chunk = paths.slice(start, start + BATCH_DOCS);
      const verdicts = await mapWithConcurrency(chunk, READ_CONCURRENCY, readFileVerdict);
      const updates: DocUpdate[] = [];
      for (const [index, verdict] of verdicts.entries()) {
        const path = chunk[index];
        if (path === undefined) {
          continue;
        }
        const wasUnreadable = unreadable.delete(path);
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
          case "unreadable": {
            unreadable.add(path);
            if (!wasUnreadable) {
              console.warn(
                `[knowledge] cannot read ${path}, keeping its last entry: ${verdict.reason}`,
              );
            }
            break;
          }
          default: {
            assertUnhandledVerdict(verdict);
          }
        }
      }
      await applyDocUpdates(updates);
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

  const removeGone = (gone: readonly string[]): void => {
    if (gone.length === 0) {
      return;
    }
    // one snapshot, taken at the first folder: re-reading the live maps per path walks the whole index per deletion.
    let indexed: string[] | undefined;
    store.transaction(() => {
      for (const path of gone) {
        unreadable.delete(path);
        // an indexed file has no indexed children, so only a folder pays for the prefix scan.
        if (removeIndexed(path)) {
          continue;
        }
        indexed ??= [...hashes.keys(), ...others];
        const prefix = `${path}/`;
        for (const candidate of indexed) {
          if (candidate.startsWith(prefix)) {
            removeIndexed(candidate);
          }
        }
      }
    });
  };

  const applyChangedPaths = async (paths: readonly string[]): Promise<void> => {
    const kinds = await mapWithConcurrency(
      paths,
      READ_CONCURRENCY,
      async (path) => await args.vault.statEntry(path),
    );
    // a set: a folder's expansion repeats the file events announced beside it.
    const files = new Set<string>();
    const gone: string[] = [];
    for (const [index, kind] of kinds.entries()) {
      const path = paths[index];
      if (path === undefined) {
        continue;
      }
      if (kind === "file") {
        files.add(path);
        continue;
      }
      if (kind === "dir") {
        assertLive();
        for (const file of await args.vault.listFilesUnder(path)) {
          files.add(file);
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
      // however it ended: dispose() stops the worker under a pass mid-projection, and nothing is
      // rebuilt for a runtime that is going away.
      if (disposed) {
        return;
      }
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
      await projector.dispose();
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

    async noteIdOwners(id) {
      await settle();
      return graph.pathsWithNoteId(id);
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
      await settle();
      return collectVaultProblems(graph, options);
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

    renameEdits: projector.renameEdits,

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

    tagRenameEdits: projector.tagRenameEdits,

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
