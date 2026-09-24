import { foldThreads } from "@repo/notes/comments/comment-threads";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import { commentsStorePath, isNoteIdKey, parseSidecar } from "@repo/notes/comments/sidecar-schema";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { TargetResolver } from "@repo/notes/knowledge/link-resolve";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import type { VaultTreeResponse } from "@repo/api/cloud/vault/vault-schema";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, VaultAssetSource } from "@repo/api/cloud/client";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { SessionPort } from "../sync/sync-runtime";
import { createMemoryNoteCache } from "./note-cache";
import type { CachedNote, NoteCache } from "./note-cache";

const NOTE_CACHE_MAX = 100;

const MAX_TREE_PAGES = 40;

const NOT_SIGNED_IN = "Not signed in.";

// a refresh that fails keeps a ready listing, whose commit still pins every read and embed, and says
// why in `refreshError`; `error` and `empty` are for a phone with no listing to keep.
export type NotesTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      commit: string;
      entries: VaultTreeResponse["entries"];
      refreshError: string | null;
    }
  | { state: "empty"; message: string }
  | { state: "error"; message: string };

export type NoteRead = ({ ok: true } & CachedNote) | { ok: false; message: string };

// a note without an id, or with no store yet, has no comments; only an unreadable store is a failure
export type CommentsRead =
  | { ok: true; threads: readonly CommentThread[] }
  | { ok: false; message: string };

// a file read pinned to the tree's commit; `notFound` is the one refusal a reader may treat as absence
type FileRead = ({ ok: true } & CachedNote) | { ok: false; notFound: boolean; message: string };

// restored: the boot read of a credential whose cached rows are on disk. signed-in: nothing on
// disk is this sign-in's.
export type SignInSource = "restored" | "signed-in";

export interface NotesStore {
  // drops what the previous sign-in fetched. null is no sign-in, or one the cloud refused, and
  // wipes the disk rows like a new sign-in does: only a restore keeps them.
  reset: (next: SignInSource | null) => void;
  // a call while this sign-in's refresh runs joins it, so an awaiting caller sees it land
  refresh: () => Promise<void>;
  tree: ReadableStore<NotesTreeState>;
  readNote: (path: string) => Promise<NoteRead>;
  // the store at the id of a note the caller already read, folded against that read's markers
  readComments: (note: CachedNote) => Promise<CommentsRead>;
  resolveWiki: (target: string) => string | null;
  // null until a tree is ready: the route refuses an unpinned asset url. the bytes then sit in the
  // platform image caches (NSURLCache, Fresco), which core RN Image cannot purge on sign-out.
  assetSource: (path: string) => VaultAssetSource | null;
}

type LiveSession = Extract<ReturnType<SessionPort["current"]>, { kind: "live" }>;

// both answer for the ready tree's commit, so they are replaced together
interface Listing {
  resolver: TargetResolver;
  paths: ReadonlySet<string>;
}

export interface CreateNotesStoreArgs {
  session: SessionPort;
  cache?: NoteCache;
}

const bestEffort = (work: Promise<void>): void => {
  void (async () => {
    try {
      await work;
    } catch {
      // best effort: a cache that throws is the adapter's problem, not the store's guarantee
    }
  })();
};

// every await is followed by the session's fence: a response from an earlier sign-in, or from one
// the cloud has since refused, must not land.
export const createNotesStore = (args: CreateNotesStoreArgs): NotesStore => {
  const { session } = args;
  let listing: Listing | null = null;
  // keyed by session id, so a new sign-in's refresh never joins the previous sign-in's stalled one.
  let refreshing: { sessionId: number; done: Promise<void> } | null = null;
  const noteCache = args.cache ?? createMemoryNoteCache(NOTE_CACHE_MAX);
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });
  const assetSources = new Map<string, VaultAssetSource>();

  // only a read pinned to the tree's commit touches the cache: head moves.
  const readFile = async (path: string): Promise<FileRead> => {
    const current = session.current();
    if (current.kind !== "live") {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    const view = tree.get();
    const commit = view.state === "ready" ? view.commit : undefined;

    if (commit !== undefined) {
      const cached = await noteCache.get(commit, path).catch(() => null);
      if (!session.fenced(current.id)) {
        return { message: NOT_SIGNED_IN, notFound: false, ok: false };
      }
      if (cached !== null) {
        return { ok: true, ...cached };
      }
    }

    const query: Parameters<CloudClient["vaultFile"]>[0] = { path };
    if (commit !== undefined) {
      query.ref = commit;
    }
    const result = await current.client.vaultFile(query);
    if (!session.fenced(current.id)) {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    if (!result.ok) {
      session.recordFailure(result.failure);
      return {
        message: describeCloudFailure(result.failure),
        notFound: result.failure.kind === "refused" && result.failure.code === "not-found",
        ok: false,
      };
    }
    if (commit !== undefined) {
      bestEffort(noteCache.set({ commit, content: result.value.content, path }));
    }
    return { commit: result.value.commit, content: result.value.content, ok: true, path };
  };

  const refreshFailed = (message: string): void => {
    const view = tree.get();
    tree.set(
      view.state === "ready" ? { ...view, refreshError: message } : { message, state: "error" },
    );
  };

  const walkTree = async (current: LiveSession): Promise<void> => {
    if (tree.get().state === "idle") {
      tree.set({ state: "loading" });
    }
    const entries: VaultTreeResponse["entries"][number][] = [];
    let commit: string | undefined;
    let after: string | undefined;
    for (let page = 0; page < MAX_TREE_PAGES; page += 1) {
      const query: Parameters<CloudClient["vaultTree"]>[0] = {};
      if (commit !== undefined) {
        query.ref = commit;
      }
      if (after !== undefined) {
        query.after = after;
      }
      const result = await current.client.vaultTree(query);
      if (!session.fenced(current.id)) {
        return;
      }
      if (!result.ok) {
        if (session.recordFailure(result.failure) === "ended") {
          return;
        }
        // an account with no hosted vault answers 404 forever; that is a state, not a fault to
        // hunt.
        const noVault = result.failure.kind === "refused" && result.failure.code === "not-found";
        if (noVault && tree.get().state !== "ready") {
          tree.set({
            message: "No hosted vault yet — sync a desktop to your account first.",
            state: "empty",
          });
        } else {
          refreshFailed(describeCloudFailure(result.failure));
        }
        return;
      }
      ({ commit } = result.value);
      entries.push(...result.value.entries);
      after = result.value.next ?? undefined;
      if (after === undefined) {
        break;
      }
    }
    if (commit === undefined) {
      return;
    }
    if (after !== undefined) {
      refreshFailed("This vault is too large for the notes list.");
      return;
    }
    const paths = entries.map((entry) => entry.path);
    // alias tiers stay empty: an alias lives in frontmatter the phone does not hold.
    listing = { paths: new Set(paths), resolver: buildResolver(paths) };
    assetSources.clear();
    tree.set({ commit, entries, refreshError: null, state: "ready" });
    bestEffort(noteCache.sweep(commit));
  };

  return {
    assetSource(path) {
      const current = session.current();
      const view = tree.get();
      if (current.kind !== "live" || view.state !== "ready") {
        return null;
      }
      const cached = assetSources.get(path);
      if (cached !== undefined) {
        return cached;
      }
      const source = current.client.vaultAssetSource({ path, ref: view.commit });
      assetSources.set(path, source);
      return source;
    },

    async readComments(note) {
      const id = frontmatterId(note.content);
      if (id === null || !isNoteIdKey(id)) {
        return { ok: true, threads: [] };
      }
      const storePath = commentsStorePath(id);
      // the listing names every path at the commit the store's read would pin to
      if (listing !== null && !listing.paths.has(storePath)) {
        return { ok: true, threads: [] };
      }
      const store = await readFile(storePath);
      if (!store.ok) {
        return store.notFound ? { ok: true, threads: [] } : { message: store.message, ok: false };
      }
      const parsed = parseSidecar(store.content);
      if (!parsed.ok) {
        return { message: `The comments could not be read: ${parsed.error}`, ok: false };
      }
      return {
        ok: true,
        threads: foldThreads(parsed.sidecar, markerRootIds(note.content)).threads,
      };
    },

    async readNote(path) {
      const read = await readFile(path);
      return read.ok
        ? { commit: read.commit, content: read.content, ok: true, path: read.path }
        : { message: read.message, ok: false };
    },

    async refresh() {
      const current = session.current();
      if (current.kind !== "live") {
        return;
      }
      if (refreshing?.sessionId === current.id) {
        await refreshing.done;
        return;
      }
      const slot = { done: walkTree(current), sessionId: current.id };
      refreshing = slot;
      try {
        await slot.done;
      } finally {
        if (refreshing === slot) {
          refreshing = null;
        }
      }
    },

    reset(next) {
      listing = null;
      assetSources.clear();
      tree.set({ state: "idle" });
      if (next !== "restored") {
        bestEffort(noteCache.clear());
      }
    },

    resolveWiki(target) {
      return listing === null ? null : listing.resolver.resolveWiki(target);
    },

    tree,
  };
};
