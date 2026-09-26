import { foldThreads } from "@repo/notes/comments/comment-threads";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import { commentsStorePath, isNoteIdKey, parseSidecar } from "@repo/notes/comments/sidecar-schema";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { TargetResolver } from "@repo/notes/knowledge/link-resolve";
import { extnamePath } from "@repo/notes/knowledge/vault-path";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure, VaultAssetSource } from "@repo/api/cloud/client";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { SqlDriver } from "../lib/sql-driver";
import type { SessionPort } from "../sync/sync-runtime";
import type { AttachmentFiles } from "./attachment-files";
import { createVaultMirror } from "./vault-mirror";
import type { Fence, MirrorProgress, MirrorRow, MirrorText, TreeEntry } from "./vault-mirror";

const NOT_SIGNED_IN = "Not signed in.";

const INCOMPLETE = "Some notes did not download. Pull down to try again.";

// a refresh that fails keeps the listing it has and says why in `refreshError`; `error` and
// `empty` are for a phone holding nothing. `progress` counts a FIRST mirror's texts in, and is
// null once the phone has held a whole vault.
export type NotesTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      entries: readonly TreeEntry[];
      refreshError: string | null;
      progress: MirrorProgress | null;
    }
  | { state: "empty"; message: string }
  | { state: "error"; message: string };

export interface NoteText {
  path: string;
  content: string;
}

export type NoteRead = ({ ok: true } & NoteText) | { ok: false; message: string };

// a note without an id, or with no store yet, has no comments; only an unreadable store is a failure
export type CommentsRead =
  | { ok: true; threads: readonly CommentThread[] }
  | { ok: false; message: string };

type AttachmentRead = { ok: true; uri: string } | { ok: false; message: string };

// `notFound` is the one refusal a reader may treat as absence
type FileRead = ({ ok: true } & NoteText) | { ok: false; notFound: boolean; message: string };

// restored: the boot read of a credential whose rows are on disk. signed-in: nothing on disk is
// this sign-in's.
export type SignInSource = "restored" | "signed-in";

export interface NotesStore {
  // drops what the previous sign-in held. null is no sign-in, or one the cloud refused, and wipes
  // the rows and attachments like a new sign-in does: only a restore keeps them, and serves them
  // before any request.
  reset: (next: SignInSource | null) => void;
  // a call while this sign-in's refresh runs joins it, so an awaiting caller sees it land
  refresh: () => Promise<void>;
  tree: ReadableStore<NotesTreeState>;
  readNote: (path: string) => Promise<NoteRead>;
  // the store at the id of a note the caller already read, folded against that read's markers
  readComments: (note: NoteText) => Promise<CommentsRead>;
  // `alias` is what follows a link's last pipe: a uuid there names the note by its frontmatter id
  resolveWiki: (target: string, alias?: string) => string | null;
  // the bytes on this phone, downloaded on the first ask
  attachmentFile: (path: string) => Promise<AttachmentRead>;
  // null until the mirror names the path: the route refuses an unpinned asset url. the bytes then
  // sit in the platform image caches (NSURLCache, Fresco), which core RN Image cannot purge.
  assetSource: (path: string) => VaultAssetSource | null;
}

type LiveSession = Extract<ReturnType<SessionPort["current"]>, { kind: "live" }>;

interface Listing {
  resolver: TargetResolver;
  files: ReadonlyMap<string, MirrorRow>;
}

export interface CreateNotesStoreArgs {
  session: SessionPort;
  db: SqlDriver;
  attachments: AttachmentFiles;
}

const storageMessage = (detail: string): string =>
  `This phone could not keep your notes: ${detail}`;

const listingOf = (rows: readonly MirrorRow[]): Listing => ({
  files: new Map(rows.map((row) => [row.path, row])),
  resolver: buildResolver(
    rows.map((row) => row.path),
    rows.flatMap((row) => row.aliases.map((alias): [string, string] => [alias, row.path])),
    rows.flatMap((row): [string, string][] =>
      row.noteId === null ? [] : [[row.noteId, row.path]],
    ),
  ),
});

// every await is followed by a fence: the session's, so a response from an earlier sign-in or one
// the cloud has since refused never lands, and a wipe generation, so a write started before a
// sign-out or a revocation never lands either.
export const createNotesStore = (args: CreateNotesStoreArgs): NotesStore => {
  const { attachments, session } = args;
  const mirror = createVaultMirror(args.db);
  let listing: Listing | null = null;
  let generation = 0;
  // the last reset's own work, which a refresh waits out: a wipe must land before the walk reads
  // the mirrored commit, and a restore's rows before the walk's replace them
  let resetWork: Promise<void> = Promise.resolve();
  // keyed by session id, so a new sign-in's refresh never joins the previous sign-in's stalled one
  let refreshing: { sessionId: number; done: Promise<void> } | null = null;
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });
  const assetSources = new Map<string, { pinCommit: string; source: VaultAssetSource }>();

  const fenceFor = (sessionId: number): Fence => {
    const started = generation;
    return () => session.fenced(sessionId) && generation === started;
  };

  const refreshFailed = (message: string): void => {
    const view = tree.get();
    tree.set(
      view.state === "ready" ? { ...view, refreshError: message } : { message, state: "error" },
    );
  };

  // a failure ending the sign-in says nothing more: the composition root idles the store
  const cloudFailed = (failure: CloudFailure): void => {
    if (session.recordFailure(failure) === "continue") {
      refreshFailed(describeCloudFailure(failure));
    }
  };

  // nothing held yet is no listing: the screen keeps loading rather than drawing an empty vault
  const publishListing = async (fence: Fence, refreshError: string | null): Promise<void> => {
    const snapshot = await mirror.snapshot();
    if (!fence() || (snapshot.rows.length === 0 && snapshot.mirroredCommit === null)) {
      return;
    }
    listing = listingOf(snapshot.rows);
    tree.set({
      entries: snapshot.rows.map(({ oid, path, size }) => ({ oid, path, size })),
      progress: snapshot.mirroredCommit === null ? snapshot.progress : null,
      refreshError,
      state: "ready",
    });
  };

  const publishProgress = (fence: Fence, progress: MirrorProgress): void => {
    const view = tree.get();
    if (fence() && view.state === "ready") {
      tree.set({ ...view, progress });
    }
  };

  const fillTexts = async (
    current: LiveSession,
    fence: Fence,
    commit: string,
    firstMirror: boolean,
  ): Promise<void> => {
    const filled = await mirror.fillTexts(current.client, commit, fence, (progress) => {
      if (firstMirror) {
        publishProgress(fence, progress);
      }
    });
    if (filled.kind === "fenced") {
      return;
    }
    // the texts that did land are shown either way
    await publishListing(fence, filled.kind === "incomplete" ? INCOMPLETE : null);
    if (filled.kind === "failed" && fence()) {
      cloudFailed(filled.failure);
    }
  };

  const walkAndFill = async (current: LiveSession): Promise<void> => {
    const fence = fenceFor(current.id);
    await resetWork;
    if (!fence()) {
      return;
    }
    if (tree.get().state === "idle") {
      tree.set({ state: "loading" });
    }
    const walked = await mirror.walkHead(current.client, fence);
    switch (walked.kind) {
      case "fenced": {
        return;
      }
      case "failed": {
        cloudFailed(walked.failure);
        return;
      }
      // an account with no hosted vault answers 404 forever; that is a state, not a fault to hunt
      case "no-vault": {
        if (tree.get().state === "ready") {
          refreshFailed("No hosted vault yet — sync a desktop to your account first.");
        } else {
          tree.set({
            message: "No hosted vault yet — sync a desktop to your account first.",
            state: "empty",
          });
        }
        return;
      }
      case "too-large": {
        refreshFailed("This vault is too large for the notes list.");
        return;
      }
      case "current": {
        const view = tree.get();
        if (view.state !== "ready") {
          await publishListing(fence, null);
        } else if (view.refreshError !== null) {
          tree.set({ ...view, refreshError: null });
        }
        return;
      }
      case "applied": {
        await publishListing(fence, null);
        await fillTexts(current, fence, walked.commit, walked.firstMirror);
        break;
      }
      // no default
    }
  };

  // a mirror that cannot be read or written is a failure of this phone, never of the cloud's
  const guarded = async (current: LiveSession): Promise<void> => {
    const fence = fenceFor(current.id);
    try {
      await walkAndFill(current);
    } catch (error) {
      if (fence()) {
        refreshFailed(storageMessage(error instanceof Error ? error.message : String(error)));
      }
    }
  };

  const hydrate = async (sessionId: number): Promise<void> => {
    const fence = fenceFor(sessionId);
    try {
      await publishListing(fence, null);
    } catch (error) {
      if (fence()) {
        tree.set({
          message: storageMessage(error instanceof Error ? error.message : String(error)),
          state: "error",
        });
      }
    }
  };

  const wipe = async (): Promise<void> => {
    try {
      await mirror.wipe();
    } catch {
      // a sign-in after this one wipes again, and a stale row is only served to a live session
    }
    try {
      await attachments.clear();
    } catch {
      // the same: the next wipe retries, and a file is only found through a live session's row
    }
  };

  // a row the mirror names but has not filled is read at the commit that named its blob, and kept
  const readFile = async (path: string): Promise<FileRead> => {
    const current = session.current();
    if (current.kind !== "live") {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    const fence = fenceFor(current.id);
    let held: MirrorText | null;
    try {
      held = await mirror.readText(path);
    } catch (error) {
      return {
        message: storageMessage(error instanceof Error ? error.message : String(error)),
        notFound: false,
        ok: false,
      };
    }
    if (!fence()) {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    if (held !== null && held.content !== null) {
      return { content: held.content, ok: true, path };
    }

    const query: Parameters<CloudClient["vaultFile"]>[0] = { path };
    if (held !== null) {
      query.ref = held.pinCommit;
    }
    const result = await current.client.vaultFile(query);
    if (!fence()) {
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
    if (held !== null && result.value.oid === held.oid) {
      try {
        await mirror.storeText({ content: result.value.content, oid: held.oid, path }, fence);
      } catch {
        // served either way; the next refresh or read stores it
      }
    }
    return { content: result.value.content, ok: true, path };
  };

  return {
    assetSource(path) {
      const current = session.current();
      const file = listing?.files.get(path);
      if (current.kind !== "live" || file === undefined) {
        return null;
      }
      const cached = assetSources.get(path);
      if (cached?.pinCommit === file.pinCommit) {
        return cached.source;
      }
      const source = current.client.vaultAssetSource({ path, ref: file.pinCommit });
      assetSources.set(path, { pinCommit: file.pinCommit, source });
      return source;
    },

    async attachmentFile(path) {
      const current = session.current();
      const file = listing?.files.get(path);
      if (current.kind !== "live") {
        return { message: NOT_SIGNED_IN, ok: false };
      }
      if (file === undefined) {
        return { message: "This attachment is not in your vault.", ok: false };
      }
      const fence = fenceFor(current.id);
      const name = `${file.oid}${extnamePath(path)}`;
      try {
        const found = await attachments.find(name);
        if (!fence()) {
          return { message: NOT_SIGNED_IN, ok: false };
        }
        if (found !== null) {
          return { ok: true, uri: found };
        }
        const result = await current.client.vaultAsset({ path, ref: file.pinCommit });
        if (!fence()) {
          return { message: NOT_SIGNED_IN, ok: false };
        }
        if (!result.ok) {
          session.recordFailure(result.failure);
          return { message: describeCloudFailure(result.failure), ok: false };
        }
        return { ok: true, uri: await attachments.save(name, result.value.bytes) };
      } catch (error) {
        return {
          message: storageMessage(error instanceof Error ? error.message : String(error)),
          ok: false,
        };
      }
    },

    async readComments(note) {
      const id = frontmatterId(note.content);
      if (id === null || !isNoteIdKey(id)) {
        return { ok: true, threads: [] };
      }
      const storePath = commentsStorePath(id);
      // the mirror names every path its tree held; a store it does not name is none
      if (listing !== null && !listing.files.has(storePath)) {
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
        ? { content: read.content, ok: true, path: read.path }
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
      const slot = { done: guarded(current), sessionId: current.id };
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
      generation += 1;
      listing = null;
      assetSources.clear();
      tree.set({ state: "idle" });
      if (next !== "restored") {
        resetWork = wipe();
        return;
      }
      const current = session.current();
      resetWork = current.kind === "live" ? hydrate(current.id) : Promise.resolve();
    },

    resolveWiki(target, alias) {
      return listing === null ? null : listing.resolver.resolveWiki(target, alias);
    },

    tree,
  };
};
