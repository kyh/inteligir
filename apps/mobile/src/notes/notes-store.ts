import { foldThreads } from "@repo/notes/comments/comment-threads";
import type { CommentThread } from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import { commentsStorePath, isNoteIdKey, parseSidecar } from "@repo/notes/comments/sidecar-schema";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import type { TargetResolver } from "@repo/notes/knowledge/link-resolve";
import { extnamePath } from "@repo/notes/knowledge/vault-path";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { diff3 } from "@repo/notes/text/diff3";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure, VaultAssetSource } from "@repo/api/cloud/client";
import { vaultCollisionKey } from "@repo/api/cloud/vault/vault-commit-schema";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { createSerialLock } from "../lib/sql-driver";
import type { SqlDriver } from "../lib/sql-driver";
import type { SessionPort } from "../sync/sync-runtime";
import type { AttachmentFiles } from "./attachment-files";
import { blobOid, isTextOp, opPaths, textBlobOid } from "./outbox-ops";
import type { OutboxRow, Sha1 } from "./outbox-ops";
import type { OutboxFiles } from "./outbox-files";
import { createVaultOutbox } from "./vault-outbox";
import type { OutboxStatus } from "./vault-outbox";
import { landOnRows, createVaultMirror } from "./vault-mirror";
import type { Fence, MirrorLanding, MirrorProgress, MirrorRow, MirrorText } from "./vault-mirror";
import { overlayEntries } from "./vault-overlay";
import type { OverlayEntry } from "./vault-overlay";

const NOT_SIGNED_IN = "Not signed in.";

const INCOMPLETE = "Some notes did not download. Pull down to try again.";

// a write races a landing that rebases the row it meant to join; past this the note keeps changing
const MAX_WRITE_ATTEMPTS = 3;

const DEFAULT_RETRY_BASE_MS = 2000;

// `oid` is the vault's blob, null for bytes only this phone holds so far
interface NoteEntry {
  path: string;
  oid: string | null;
  size: number;
}

// a refresh that fails keeps the listing it has and says why in `refreshError`; `error` and
// `empty` are for a phone holding nothing. `progress` counts a FIRST mirror's texts in, and is
// null once the phone has held a whole vault.
export type NotesTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      entries: readonly NoteEntry[];
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

// `notFound` is the one refusal a reader may treat as absence; `oid` is null for text only this
// phone holds
type FileRead =
  | ({ ok: true; oid: string | null } & NoteText)
  | { ok: false; notFound: boolean; message: string };

// the write surface mirrors @repo/editor's VaultIO: a write lands once it is durable on this
// phone, answering the bytes it holds for the path, which a rebase onto the phone's own merge can
// widen; `vanished` is a note this phone deleted or renamed away since the caller read it
type WriteOutcome = { kind: "landed"; content: string; conflicted: boolean } | { kind: "vanished" };

type CreateOutcome = { kind: "created" } | { kind: "exists" };

type RenameOutcome = { kind: "renamed" } | { kind: "exists" } | { kind: "vanished" };

// restored: the boot read of a credential whose rows are on disk. signed-in: nothing on disk is
// this sign-in's.
export type SignInSource = "restored" | "signed-in";

export interface NotesStore {
  // drops what the previous sign-in held. null is no sign-in, or one the cloud refused, and wipes
  // the rows, the unsent writes and the attachments like a new sign-in does: only a restore keeps
  // them, and serves them before any request.
  reset: (next: SignInSource | null) => void;
  // a call while this sign-in's refresh runs joins it, so an awaiting caller sees it land
  refresh: () => Promise<void>;
  // sends the unsent writes, oldest first; a call while a send runs joins it
  drain: () => Promise<void>;
  tree: ReadableStore<NotesTreeState>;
  // a read records the base the caller's next write to that path is guarded by
  readNote: (path: string) => Promise<NoteRead>;
  // throws when the caller never read the path: an inferred base lets a concurrent edit win
  write: (path: string, content: string) => Promise<WriteOutcome>;
  create: (path: string, content: string) => Promise<CreateOutcome>;
  rename: (from: string, to: string) => Promise<RenameOutcome>;
  remove: (path: string) => Promise<void>;
  putAsset: (path: string, bytes: Uint8Array) => Promise<CreateOutcome>;
  // told when the bytes this phone holds for a path change other than through `write`: a merge
  // that landed more than was written, another device's edit, a discard
  watchPath: (path: string, onChange: () => void) => () => void;
  // what has not reached the vault, parked rows included; the sign-out asks before discarding it
  unsentCount: () => Promise<number>;
  outbox: {
    status: ReadableStore<OutboxStatus>;
    retry: (seq: number) => Promise<void>;
    saveAsNew: (seq: number) => Promise<string | null>;
    discard: (seq: number) => Promise<void>;
    dismiss: (noticeId: number) => void;
  };
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
  files: ReadonlyMap<string, OverlayEntry>;
  taken: ReadonlySet<string>;
}

// what the caller's next write to a path is guarded by: `seen` is the text it last read or wrote,
// `base` the vault's blob that text derives from, null for a note the vault has not held
interface Guard {
  base: { oid: string; content: string } | null;
  seen: string;
}

export interface CreateNotesStoreArgs {
  session: SessionPort;
  db: SqlDriver;
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  // the name this phone's conflict reports and copies go by
  deviceName: string;
  // the first wait after a failed send, doubling; null never retries on a timer
  retryBaseMs?: number | null;
}

const storageMessage = (detail: string): string =>
  `This phone could not keep your notes: ${detail}`;

const listingOf = (entries: readonly OverlayEntry[]): Listing => ({
  files: new Map(entries.map((entry) => [entry.path, entry])),
  resolver: buildResolver(
    entries.map((entry) => entry.path),
    entries.flatMap((entry) => entry.aliases.map((alias): [string, string] => [alias, entry.path])),
    entries.flatMap((entry): [string, string][] =>
      entry.noteId === null ? [] : [[entry.noteId, entry.path]],
    ),
  ),
  taken: new Set(entries.map((entry) => vaultCollisionKey(entry.path))),
});

const noteEntryOf = (entry: OverlayEntry): NoteEntry => ({
  oid: entry.source.kind === "vault" ? entry.source.row.oid : null,
  path: entry.path,
  size: entry.size,
});

// what a watcher compares: a change of blob, of unsent text or of staged file is a change of bytes
const versionOf = (entry: OverlayEntry | undefined): string => {
  if (entry === undefined) {
    return "absent";
  }
  switch (entry.source.kind) {
    case "vault": {
      return `vault:${entry.source.row.oid}`;
    }
    case "text": {
      return `text:${entry.source.text}`;
    }
    case "staged": {
      return `staged:${entry.source.file}`;
    }
    // no default
  }
};

const lastRowOn = (rows: readonly OutboxRow[], path: string): OutboxRow | undefined =>
  rows.findLast((row) => opPaths(row.op).includes(path));

// every await is followed by a fence: the session's, so a response from an earlier sign-in or one
// the cloud has since refused never lands, and a wipe generation, so a write started before a
// sign-out or a revocation never lands either.
export const createNotesStore = (args: CreateNotesStoreArgs): NotesStore => {
  const { attachments, session } = args;
  const mirror = createVaultMirror(args.db);
  let listing: Listing | null = null;
  // the mirror's rows as the last snapshot read them, with every landing since laid on
  let mirrorRows: readonly MirrorRow[] | null = null;
  let landings = 0;
  let generation = 0;
  // the last reset's own work, which a refresh waits out: a wipe must land before the walk reads
  // the mirrored commit, and a restore's rows before the walk's replace them
  let resetWork: Promise<void> = Promise.resolve();
  // keyed by session id, so a new sign-in's refresh never joins the previous sign-in's stalled one
  let refreshing: { sessionId: number; done: Promise<void> } | null = null;
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });
  const assetSources = new Map<string, { pinCommit: string; source: VaultAssetSource }>();
  const guards = new Map<string, Guard>();
  const watchers = new Map<string, { version: string; listeners: Set<() => void> }>();
  // one write at a time, so the row a write joins is the row it read
  const writing = createSerialLock();

  const fenceFor = (sessionId: number): Fence => {
    const started = generation;
    return () => session.fenced(sessionId) && generation === started;
  };

  const notifyWatchers = (): void => {
    for (const [path, watcher] of watchers) {
      const version = versionOf(listing?.files.get(path));
      if (version !== watcher.version) {
        watcher.version = version;
        for (const listener of watcher.listeners) {
          listener();
        }
      }
    }
  };

  // the listing is the mirror with the unsent rows laid over it; nothing held and nothing unsent
  // is no listing, so the screen keeps loading rather than drawing an empty vault
  const relist = (
    rows: readonly OutboxRow[],
    notices?: { refreshError: string | null; progress: MirrorProgress | null },
  ): void => {
    if (mirrorRows === null && rows.length === 0) {
      listing = null;
      return;
    }
    const entries = overlayEntries(mirrorRows ?? [], rows);
    listing = listingOf(entries);
    const view = tree.get();
    const kept = notices ?? {
      progress: view.state === "ready" ? view.progress : null,
      refreshError: view.state === "ready" ? view.refreshError : null,
    };
    tree.set({ entries: entries.map(noteEntryOf), ...kept, state: "ready" });
    notifyWatchers();
  };

  // a landed write moves the base the caller's next write is guarded by, and text that landed as
  // it was written is no change to the watcher that wrote it
  const guardLandings = (landed: readonly MirrorLanding[]): void => {
    for (const landing of landed) {
      if (landing.kind !== "put" || landing.text === null) {
        continue;
      }
      const guard = guards.get(landing.path);
      if (guard !== undefined) {
        guards.set(landing.path, { ...guard, base: { content: landing.text, oid: landing.oid } });
      }
      const watcher = watchers.get(landing.path);
      if (watcher?.version === `text:${landing.text}`) {
        watcher.version = `vault:${landing.oid}`;
      }
    }
  };

  const outbox = createVaultOutbox({
    db: args.db,
    fenceFor,
    files: args.outboxFiles,
    isTaken: (path) => listing?.taken.has(vaultCollisionKey(path)) === true,
    resetWork: async () => {
      await resetWork;
    },
    onChange: (rows, landed) => {
      if (landed.length > 0) {
        landings += 1;
        if (mirrorRows !== null) {
          mirrorRows = landOnRows(mirrorRows, landed);
        }
        guardLandings(landed);
      }
      relist(rows);
    },
    retryBaseMs: args.retryBaseMs === undefined ? DEFAULT_RETRY_BASE_MS : args.retryBaseMs,
    session,
    thisDevice: args.deviceName,
  });

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

  // a landing while the snapshot was read would be lost under it, so the read is taken again
  const publishListing = async (fence: Fence, refreshError: string | null): Promise<void> => {
    for (;;) {
      const before = landings;
      const snapshot = await mirror.snapshot();
      if (!fence()) {
        return;
      }
      if (before !== landings) {
        continue;
      }
      if (snapshot.rows.length > 0 || snapshot.mirroredCommit !== null) {
        mirrorRows = snapshot.rows;
      }
      relist(outbox.rows(), {
        progress: snapshot.mirroredCommit === null ? snapshot.progress : null,
        refreshError,
      });
      return;
    }
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
      await outbox.load(fence);
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
    await outbox.wipe();
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

  const liveFence = (): Fence => {
    const current = session.current();
    if (current.kind !== "live") {
      throw new Error(NOT_SIGNED_IN);
    }
    return fenceFor(current.id);
  };

  // a note an unsent rename moved away or an unsent delete removed is gone here, whatever the
  // mirror still holds
  const goneHere = (path: string): boolean => {
    const last = lastRowOn(outbox.rows(), path);
    return (
      last !== undefined &&
      (last.op.op === "remove" || (last.op.op === "rename" && last.op.from === path))
    );
  };

  // a row the mirror names but has not filled is read at the commit that named its blob, and kept
  const readFromMirror = async (path: string, row: MirrorRow | null): Promise<FileRead> => {
    const current = session.current();
    if (current.kind !== "live") {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    const fence = fenceFor(current.id);
    const mirrorPath = row?.path ?? path;
    let held: MirrorText | null;
    try {
      held = await mirror.readText(mirrorPath);
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
      return { content: held.content, oid: held.oid, ok: true, path };
    }

    const query: Parameters<CloudClient["vaultFile"]>[0] = { path: mirrorPath };
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
        await mirror.storeText(
          { content: result.value.content, oid: held.oid, path: mirrorPath },
          fence,
        );
      } catch {
        // served either way; the next refresh or read stores it
      }
    }
    return { content: result.value.content, oid: result.value.oid, ok: true, path };
  };

  const readFile = async (path: string): Promise<FileRead> => {
    await resetWork;
    const entry = listing?.files.get(path);
    if (entry?.source.kind === "text") {
      return { content: entry.source.text, oid: null, ok: true, path };
    }
    if (entry?.source.kind === "staged" || goneHere(path)) {
      return { message: "This is not a note on this phone.", notFound: true, ok: false };
    }
    return await readFromMirror(path, entry?.source.row ?? null);
  };

  // the vault's blob the caller's view of a path derives from: an unsent write's own base, none
  // for an unsent create, else what was read
  const recordGuard = (path: string, read: { content: string; oid: string | null }): void => {
    const last = lastRowOn(outbox.rows(), path);
    let base: Guard["base"] = read.oid === null ? null : { content: read.content, oid: read.oid };
    if (last?.op.op === "write") {
      base = { content: last.op.baseContent, oid: last.op.baseOid };
    } else if (last?.op.op === "create") {
      base = null;
    } else if (last?.op.op === "rename" && last.op.baseContent !== null) {
      base = { content: last.op.baseContent, oid: last.op.baseOid };
    }
    guards.set(path, { base, seen: read.content });
  };

  const outboxBytes = async (file: string): Promise<Uint8Array> => {
    const found = await outbox.stagedUri(file);
    if (found === null) {
      throw new Error("This attachment is no longer on your phone.");
    }
    return await args.outboxFiles.read(file);
  };

  // the blob and text an unsent row leaves at a path, for a rename or a delete queued behind it
  const projectedBase = async (
    path: string,
  ): Promise<{ oid: string; content: string | null } | null> => {
    const last = lastRowOn(outbox.rows(), path);
    if (last === undefined) {
      const guard = guards.get(path)?.base;
      if (guard !== undefined && guard !== null) {
        return guard;
      }
      const entry = listing?.files.get(path);
      if (entry?.source.kind !== "vault") {
        return null;
      }
      const read = await readFromMirror(path, entry.source.row);
      return { content: read.ok ? read.content : null, oid: entry.source.row.oid };
    }
    const { op } = last;
    switch (op.op) {
      case "write":
      case "create": {
        return { content: op.content, oid: await textBlobOid(args.sha1, op.content) };
      }
      case "rename": {
        return op.to === path ? { content: op.baseContent, oid: op.baseOid } : null;
      }
      case "putAsset": {
        return { content: null, oid: await blobOid(args.sha1, await outboxBytes(op.stagedFile)) };
      }
      case "remove": {
        return null;
      }
      // no default
    }
  };

  const isTakenHere = (path: string): boolean =>
    listing?.taken.has(vaultCollisionKey(path)) === true;

  // the caller's own bytes move its watcher first, so its write is never told back to it
  const expectOwn = (path: string, content: string): void => {
    const watcher = watchers.get(path);
    if (watcher !== undefined) {
      watcher.version = `text:${content}`;
    }
  };

  const write: NotesStore["write"] = async (path, content) =>
    await writing(async () => {
      await resetWork;
      const guard = guards.get(path);
      // Not inferred from the mirror: that would let a concurrent edit merge to the vault's
      // bytes alone and drop this write silently.
      if (guard === undefined) {
        throw new Error(`write ${path}: no base was read, so nothing can guard this write`);
      }
      const fence = liveFence();
      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
        const last = lastRowOn(outbox.rows(), path);
        if (goneHere(path)) {
          return { kind: "vanished" };
        }
        const joins = last !== undefined && isTextOp(last.op) ? last.op : null;
        let onto: { oid: string; content: string } | null = guard.base;
        if (last?.op.op === "rename") {
          onto =
            last.op.baseContent === null
              ? null
              : { content: last.op.baseContent, oid: last.op.baseOid };
        }
        const ontoText = joins === null ? onto?.content : joins.content;
        if (ontoText === undefined) {
          return { kind: "vanished" };
        }
        // the caller wrote from what it last saw; bytes the phone took since (its own merge
        // landing) move under the edit rather than being overwritten by it
        const { conflicted, merged } =
          guard.seen === ontoText
            ? { conflicted: false, merged: content }
            : diff3(guard.seen, content, ontoText);
        expectOwn(path, merged);
        if (joins !== null && last !== undefined) {
          const verdict = await outbox.coalesce(last.seq, joins.content, merged, fence);
          if (verdict === "fenced") {
            throw new Error(NOT_SIGNED_IN);
          }
          if (verdict === "stale") {
            continue;
          }
        } else if (onto === null) {
          return { kind: "vanished" };
        } else if (
          !(await outbox.enqueue(
            { baseContent: onto.content, baseOid: onto.oid, content: merged, op: "write", path },
            fence,
          ))
        ) {
          throw new Error(NOT_SIGNED_IN);
        }
        guards.set(path, { ...guard, seen: merged });
        return { conflicted, content: merged, kind: "landed" };
      }
      throw new Error(`write ${path}: the note kept changing while it was saved`);
    });

  const create: NotesStore["create"] = async (path, content) =>
    await writing(async () => {
      await resetWork;
      const fence = liveFence();
      if (isTakenHere(path)) {
        return { kind: "exists" };
      }
      expectOwn(path, content);
      if (!(await outbox.enqueue({ content, op: "create", path }, fence))) {
        throw new Error(NOT_SIGNED_IN);
      }
      guards.set(path, { base: null, seen: content });
      return { kind: "created" };
    });

  const rename: NotesStore["rename"] = async (from, to) =>
    await writing(async () => {
      await resetWork;
      const fence = liveFence();
      if (listing?.files.has(from) !== true) {
        return { kind: "vanished" };
      }
      if (vaultCollisionKey(from) !== vaultCollisionKey(to) && isTakenHere(to)) {
        return { kind: "exists" };
      }
      const base = await projectedBase(from);
      if (base === null) {
        return { kind: "vanished" };
      }
      const moved = guards.get(from);
      if (
        !(await outbox.enqueue(
          { baseContent: base.content, baseOid: base.oid, from, op: "rename", to },
          fence,
        ))
      ) {
        throw new Error(NOT_SIGNED_IN);
      }
      guards.delete(from);
      if (base.content !== null) {
        guards.set(to, {
          base: { content: base.content, oid: base.oid },
          seen: moved?.seen ?? base.content,
        });
      }
      return { kind: "renamed" };
    });

  const remove: NotesStore["remove"] = async (path) => {
    await writing(async () => {
      await resetWork;
      const fence = liveFence();
      guards.delete(path);
      if (listing?.files.has(path) !== true) {
        return;
      }
      const base = await projectedBase(path);
      if (
        base !== null &&
        !(await outbox.enqueue({ baseOid: base.oid, op: "remove", path }, fence))
      ) {
        throw new Error(NOT_SIGNED_IN);
      }
    });
  };

  const putAsset: NotesStore["putAsset"] = async (path, bytes) =>
    await writing(async () => {
      await resetWork;
      const fence = liveFence();
      if (isTakenHere(path)) {
        return { kind: "exists" };
      }
      // named by the blob, so the same bytes staged twice are one file
      const stagedFile = `${await blobOid(args.sha1, bytes)}${extnamePath(path)}`;
      await outbox.stage(stagedFile, bytes);
      if (
        !(await outbox.enqueue({ op: "putAsset", path, size: bytes.length, stagedFile }, fence))
      ) {
        throw new Error(NOT_SIGNED_IN);
      }
      return { kind: "created" };
    });

  const vaultRowFor = (path: string): MirrorRow | null => {
    const entry = listing?.files.get(path);
    return entry?.source.kind === "vault" ? entry.source.row : null;
  };

  return {
    assetSource(path) {
      const current = session.current();
      const row = vaultRowFor(path);
      if (current.kind !== "live" || row === null) {
        return null;
      }
      const cached = assetSources.get(path);
      if (cached?.pinCommit === row.pinCommit) {
        return cached.source;
      }
      const source = current.client.vaultAssetSource({ path: row.path, ref: row.pinCommit });
      assetSources.set(path, { pinCommit: row.pinCommit, source });
      return source;
    },

    async attachmentFile(path) {
      const current = session.current();
      const entry = listing?.files.get(path);
      if (current.kind !== "live") {
        return { message: NOT_SIGNED_IN, ok: false };
      }
      if (entry === undefined || entry.source.kind === "text") {
        return { message: "This attachment is not in your vault.", ok: false };
      }
      const fence = fenceFor(current.id);
      try {
        if (entry.source.kind === "staged") {
          const uri = await outbox.stagedUri(entry.source.file);
          return uri === null
            ? { message: "This attachment is no longer on your phone.", ok: false }
            : { ok: true, uri };
        }
        const { row } = entry.source;
        const name = `${row.oid}${extnamePath(row.path)}`;
        const found = await attachments.find(name);
        if (!fence()) {
          return { message: NOT_SIGNED_IN, ok: false };
        }
        if (found !== null) {
          return { ok: true, uri: found };
        }
        const result = await current.client.vaultAsset({ path: row.path, ref: row.pinCommit });
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

    create,

    async drain() {
      await resetWork;
      await outbox.drain();
    },

    outbox: {
      discard: outbox.discard,
      dismiss: outbox.dismiss,
      retry: outbox.retry,
      saveAsNew: outbox.saveAsNew,
      status: outbox.status,
    },

    putAsset,

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
      if (!read.ok) {
        return { message: read.message, ok: false };
      }
      recordGuard(path, read);
      return { content: read.content, ok: true, path: read.path };
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

    remove,

    rename,

    reset(next) {
      generation += 1;
      listing = null;
      mirrorRows = null;
      guards.clear();
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

    async unsentCount() {
      await resetWork;
      return outbox.rows().length;
    },

    watchPath(path, onChange) {
      const watcher = watchers.get(path) ?? {
        listeners: new Set<() => void>(),
        version: versionOf(listing?.files.get(path)),
      };
      watcher.listeners.add(onChange);
      watchers.set(path, watcher);
      return () => {
        watcher.listeners.delete(onChange);
        if (watcher.listeners.size === 0) {
          watchers.delete(path);
        }
      };
    },

    write,
  };
};
