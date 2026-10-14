import { commentKeyOf, commentStoreKey } from "@repo/notes/comments/comment-key";
import { foldThreads } from "@repo/notes/comments/comment-threads";
import type { AddResult, CommentThread } from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import {
  commentsStorePath,
  parseSidecar,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type { CommentSidecar } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { extnamePath } from "@repo/notes/knowledge/vault-path";
import { describeCloudFailure } from "@repo/contract/cloud/client";
import type { CloudClient, CloudFailure } from "@repo/contract/cloud/client";
import { createSingleFlight } from "@repo/contract/cloud/sync/sync-session";
import { vaultCollisionKey } from "@repo/contract/cloud/vault/vault-commit-schema";
import { messageOf } from "../lib/error-message";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { Fence } from "../lib/phone-db";
import { createSignInFence, NOT_SIGNED_IN } from "../lib/sign-in-fence";
import type { SignInSource } from "../lib/sign-in-fence";
import { createSerialLock } from "../lib/sql-driver";
import type { SqlDriver } from "../lib/sql-driver";
import type { SessionPort } from "../sync/sync-runtime";
import type { AttachmentFiles } from "./attachment-files";
import { blobOid, isTextOp, leavesAt, opPaths, rebaseEdit, textBlobOid } from "./outbox-ops";
import type { CommentOp, GuardedText, OutboxRow, Sha1, VaultOp } from "./outbox-ops";
import type { OutboxFiles } from "./outbox-files";
import { createVaultOutbox, STAGED_FILE_GONE } from "./vault-outbox";
import type { OutboxStatus } from "./vault-outbox";
import { landOnRows, createVaultMirror } from "./vault-mirror";
import type { MirrorLanding, MirrorProgress, MirrorRow, MirrorText } from "./vault-mirror";
import { overlayEntries } from "./vault-overlay";
import type { OverlayEntry } from "./vault-overlay";

const INCOMPLETE = "Some notes did not download. Pull down to try again.";

const UNREADABLE_NOTE = "This note has not downloaded to your phone yet.";

const UNREADABLE_COMMENTS = "This note's comments could not be read.";

// an account whose hosted vault no Mac has pushed yet answers 404 until one does
const NO_HOSTED_VAULT = "Your notes aren't here yet — open inteligir on your Mac while signed in.";

const DEFAULT_RETRY_BASE_MS = 2000;

interface NoteEntry {
  path: string;
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

// `notFound` is the one refusal a reader may treat as absence
type FileRead = ({ ok: true } & NoteText) | { ok: false; notFound: boolean; message: string };

// the write surface is @repo/editor's GuardedVaultPort, whose one write policy the editor page
// runs: `absent` is a create, and `expected` names the text the write was computed from. A write
// lands once it is durable on this phone; `changed` hands back what the phone holds instead, for
// the caller's own merge, and `missing` is a note this phone no longer holds.
type GuardedWrite = { kind: "absent" } | { kind: "expected"; base: string };

type GuardedWriteResult =
  | { kind: "written" }
  | { kind: "exists" }
  | { kind: "changed"; current: string }
  | { kind: "missing" };

type CreateOutcome = { kind: "created" } | { kind: "exists" };

// `skipped`: notes whose planned text no longer matches what the phone holds, so they keep theirs
type RenameOutcome =
  | { kind: "renamed"; skipped: readonly string[] }
  | { kind: "exists" }
  | { kind: "vanished" };

// what a rename changes beside the move, each computed from the text it `expected` the path to
// hold: the note's own text at its new name, and the other notes whose links name it
export interface RenameEdits {
  note: { expected: string; content: string } | null;
  rewrites: readonly { path: string; expected: string; content: string }[];
}

const NO_EDITS: RenameEdits = { note: null, rewrites: [] };

// one change to a note's comment store, planned from the texts the phone holds when it is queued:
// `anchor` is the note's new text with a new comment's markers in it, computed from the text it
// `expected` the note to hold, and null for a reply or a resolve, which leave the note alone
interface CommentEdit {
  path: string;
  anchor: { expected: string; content: string } | null;
  edit: (sidecar: CommentSidecar) => AddResult;
}

// `note`: the note's text on the phone now, which an id minted for its first comment adds to
export type CommentEditOutcome =
  | { kind: "edited"; note: string }
  | { kind: "changed"; current: string }
  | { kind: "vanished" }
  | { kind: "refused"; message: string };

// a listed file with the frontmatter facts its held text carries
export interface HeldFile {
  path: string;
  noteId: string | null;
  aliases: readonly string[];
}

export interface NotesStore {
  // drops what the previous sign-in held. null is no sign-in, or one the cloud refused, and wipes
  // the rows, the unsent writes and the attachments like a new sign-in does: only a restore keeps
  // them, and serves them before any request.
  reset: (next: SignInSource | null) => void;
  // a call while a refresh runs waits for it and one more walk after it, which reads whatever the
  // vault took while the first one listed it
  refresh: () => Promise<void>;
  // sends the unsent writes, oldest first; a call while a send runs joins it
  drain: () => Promise<void>;
  tree: ReadableStore<NotesTreeState>;
  readNote: (path: string) => Promise<NoteRead>;
  // `expected` is compared with the text the phone holds, under the lock every change here takes
  write: (path: string, content: string, guard: GuardedWrite) => Promise<GuardedWriteResult>;
  create: (path: string, content: string) => Promise<CreateOutcome>;
  // the move and its edits are one change set
  rename: (from: string, to: string, edits?: RenameEdits) => Promise<RenameOutcome>;
  // the note and the comment `stores` that go with it are one change set
  remove: (path: string, stores?: readonly string[]) => Promise<void>;
  putAsset: (path: string, bytes: Uint8Array) => Promise<CreateOutcome>;
  // every file the phone lists, unsent changes laid over; none before the first listing
  heldFiles: () => readonly HeldFile[];
  // the text the phone holds for each note it lists; a note whose text has not downloaded is
  // left out
  noteTexts: () => Promise<ReadonlyMap<string, string>>;
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
  // the store's edit and the note's anchored text, one change set; a note without an id takes one
  // with its first comment
  editComments: (edit: CommentEdit) => Promise<CommentEditOutcome>;
  // the bytes on this phone, downloaded on the first ask
  attachmentFile: (path: string) => Promise<AttachmentRead>;
}

type LiveSession = Extract<ReturnType<SessionPort["current"]>, { kind: "live" }>;

interface QueuedWrite {
  fence: Fence;
  // throws when the sign-in the write began under has ended
  enqueue: (op: VaultOp) => Promise<void>;
}

interface Listing {
  files: ReadonlyMap<string, OverlayEntry>;
  taken: ReadonlySet<string>;
}

export interface CreateNotesStoreArgs {
  session: SessionPort;
  db: SqlDriver;
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  // the name this phone's conflict reports and copies go by
  deviceName: string;
  // a note's new frontmatter id, uuid-shaped, for its first comment made here
  mintNoteId: () => string;
  // the first wait after a failed send, doubling; null never retries on a timer
  retryBaseMs?: number | null;
}

const storageMessage = (cause: unknown): string =>
  `This phone could not keep your notes: ${messageOf(cause)}`;

const listingOf = (entries: readonly OverlayEntry[]): Listing => ({
  files: new Map(entries.map((entry) => [entry.path, entry])),
  taken: new Set(entries.map((entry) => vaultCollisionKey(entry.path))),
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
  // a refresh waits out the last reset's work: a wipe must land before the walk reads the mirrored
  // commit, and a restore's rows before the walk's replace them
  const signIn = createSignInFence(session);
  const refreshing = createSingleFlight();
  const tree = createExternalStore<NotesTreeState>({ state: "idle" });
  const watchers = new Map<string, { version: string; listeners: Set<() => void> }>();
  // one write at a time, so the row a write joins is the row it read
  const writing = createSerialLock();

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
    tree.set({ entries: entries.map((entry) => ({ path: entry.path })), ...kept, state: "ready" });
    notifyWatchers();
  };

  // text that landed as it was written is no change to the watcher that wrote it
  const expectLandings = (landed: readonly MirrorLanding[]): void => {
    for (const landing of landed) {
      if (landing.kind !== "put" || landing.text === null) {
        continue;
      }
      const watcher = watchers.get(landing.path);
      if (watcher?.version === `text:${landing.text}`) {
        watcher.version = `vault:${landing.oid}`;
      }
    }
  };

  const outbox = createVaultOutbox({
    db: args.db,
    files: args.outboxFiles,
    isTaken: (path) => listing?.taken.has(vaultCollisionKey(path)) === true,
    // the staged name is the blob's, as the attachment cache names it
    keepLanded: async (file, bytes) => {
      await attachments.save(file, bytes);
    },
    onChange: (rows, landed) => {
      if (landed.length > 0) {
        landings += 1;
        if (mirrorRows !== null) {
          mirrorRows = landOnRows(mirrorRows, landed);
        }
        expectLandings(landed);
      }
      relist(rows);
    },
    retryBaseMs: args.retryBaseMs === undefined ? DEFAULT_RETRY_BASE_MS : args.retryBaseMs,
    session,
    signIn,
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
    walked: { commit: string; settled: boolean; firstMirror: boolean },
  ): Promise<void> => {
    const filled = await mirror.fillTexts(current.client, walked, fence, (progress) => {
      if (walked.firstMirror) {
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
    const fence = signIn.fenceFor(current.id);
    await signIn.ready();
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
          refreshFailed(NO_HOSTED_VAULT);
        } else {
          tree.set({ message: NO_HOSTED_VAULT, state: "empty" });
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
        await fillTexts(current, fence, walked);
        break;
      }
      // no default
    }
  };

  // a mirror that cannot be read or written is a failure of this phone, never of the cloud's
  const guarded = async (current: LiveSession): Promise<void> => {
    const fence = signIn.fenceFor(current.id);
    try {
      await walkAndFill(current);
    } catch (error) {
      if (fence()) {
        refreshFailed(storageMessage(error));
      }
    }
  };

  const hydrate = async (sessionId: number): Promise<void> => {
    const fence = signIn.fenceFor(sessionId);
    try {
      await outbox.load(fence);
      await publishListing(fence, null);
    } catch (error) {
      if (fence()) {
        tree.set({ message: storageMessage(error), state: "error" });
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

  const queued = async <T>(work: (write: QueuedWrite) => Promise<T>): Promise<T> =>
    await writing(async () => {
      await signIn.ready();
      const fence = signIn.live();
      if (fence === null) {
        throw new Error(NOT_SIGNED_IN);
      }
      return await work({
        enqueue: async (op) => {
          if (!(await outbox.enqueue(op, fence))) {
            throw new Error(NOT_SIGNED_IN);
          }
        },
        fence,
      });
    });

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
    const fence = signIn.fenceFor(current.id);
    const mirrorPath = row?.path ?? path;
    let held: MirrorText | null;
    try {
      held = await mirror.readText(mirrorPath);
    } catch (error) {
      return { message: storageMessage(error), notFound: false, ok: false };
    }
    if (!fence()) {
      return { message: NOT_SIGNED_IN, notFound: false, ok: false };
    }
    if (held !== null && held.content !== null) {
      return { content: held.content, ok: true, path };
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
    return { content: result.value.content, ok: true, path };
  };

  const readFile = async (path: string): Promise<FileRead> => {
    await signIn.ready();
    const entry = listing?.files.get(path);
    if (entry?.source.kind === "text") {
      return { content: entry.source.text, ok: true, path };
    }
    if (entry?.source.kind === "staged" || goneHere(path)) {
      return { message: "This is not a note on this phone.", notFound: true, ok: false };
    }
    return await readFromMirror(path, entry?.source.row ?? null);
  };

  const outboxBytes = async (file: string): Promise<Uint8Array> => {
    const found = await outbox.stagedUri(file);
    if (found === null) {
      throw new Error(STAGED_FILE_GONE);
    }
    return await args.outboxFiles.read(file);
  };

  // what the phone holds at a path now, and the blob the vault takes a change to it against: what
  // the last unsent row on the path leaves there, else the mirror's row
  const heldText = async (
    path: string,
  ): Promise<{ oid: string; content: string | null } | null> => {
    const last = lastRowOn(outbox.rows(), path);
    if (last === undefined) {
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
      case "rename":
      case "comment": {
        return await leavesAt(args.sha1, op, path);
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

  const create: NotesStore["create"] = async (path, content) =>
    await queued(async ({ enqueue }) => {
      if (isTakenHere(path)) {
        return { kind: "exists" };
      }
      expectOwn(path, content);
      await enqueue({ content, op: "create", path });
      return { kind: "created" };
    });

  // the note a guarded write is compared with; one whose text has not downloaded is no text the
  // write could have been computed from
  const heldNote = async (
    path: string,
  ): Promise<{ kind: "held"; oid: string; content: string } | { kind: "missing" }> => {
    const held = goneHere(path) ? null : await heldText(path);
    if (held === null) {
      return { kind: "missing" };
    }
    if (held.content === null) {
      throw new Error(UNREADABLE_NOTE);
    }
    return { content: held.content, kind: "held", oid: held.oid };
  };

  // compared and queued under the write lock, so no other change made here slips between the text
  // the guard was checked against and the row that carries the write. A mismatch is never merged
  // here: the merge is the caller's write policy, and a second one is a second answer to what a
  // stale save does.
  const writeExpected = async (
    path: string,
    content: string,
    base: string,
  ): Promise<GuardedWriteResult> =>
    await queued(async ({ enqueue, fence }) => {
      const held = await heldNote(path);
      if (held.kind === "missing") {
        return held;
      }
      if (held.content !== base) {
        return { current: held.content, kind: "changed" };
      }
      const last = lastRowOn(outbox.rows(), path);
      expectOwn(path, content);
      if (last !== undefined && isTextOp(last.op)) {
        const verdict = await outbox.coalesce(last.seq, last.op.content, content, fence);
        if (verdict === "fenced") {
          throw new Error(NOT_SIGNED_IN);
        }
        // a landing since the compare retired or rebased the row the write meant to join
        if (verdict === "stale") {
          const now = await heldNote(path);
          return now.kind === "missing" ? now : { current: now.content, kind: "changed" };
        }
      } else {
        await enqueue({ baseContent: held.content, baseOid: held.oid, content, op: "write", path });
      }
      return { kind: "written" };
    });

  const write: NotesStore["write"] = async (path, content, guard) => {
    if (guard.kind === "expected") {
      return await writeExpected(path, content, guard.base);
    }
    const created = await create(path, content);
    return created.kind === "created" ? { kind: "written" } : created;
  };

  // a note that no longer holds the text its rewrite was planned from is left out, never merged,
  // as the server's rewrite leaves one; the renamed note's alias still answers its link
  const heldRewrites = async (
    edits: RenameEdits,
    moved: ReadonlySet<string>,
    skipped: string[],
  ): Promise<GuardedText[]> => {
    const rewrites: GuardedText[] = [];
    for (const rewrite of edits.rewrites) {
      const held = moved.has(rewrite.path) ? null : await heldText(rewrite.path);
      if (held === null || held.content !== rewrite.expected) {
        skipped.push(rewrite.path);
        continue;
      }
      rewrites.push({
        baseContent: held.content,
        baseOid: held.oid,
        content: rewrite.content,
        path: rewrite.path,
      });
    }
    return rewrites;
  };

  const rename: NotesStore["rename"] = async (from, to, edits = NO_EDITS) =>
    await queued(async ({ enqueue }) => {
      if (listing?.files.has(from) !== true) {
        return { kind: "vanished" };
      }
      if (vaultCollisionKey(from) !== vaultCollisionKey(to) && isTakenHere(to)) {
        return { kind: "exists" };
      }
      const base = await heldText(from);
      if (base === null) {
        return { kind: "vanished" };
      }
      const skipped: string[] = [];
      // the note's own edit rides onto a note that changed since it was planned
      const carried =
        edits.note === null || base.content === null
          ? null
          : rebaseEdit(edits.note.expected, edits.note.content, base.content);
      const content = carried === base.content ? null : carried;
      const rewrites = await heldRewrites(edits, new Set([from, to]), skipped);
      await enqueue({
        baseContent: base.content,
        baseOid: base.oid,
        content,
        from,
        op: "rename",
        rewrites,
        to,
      });
      return { kind: "renamed", skipped };
    });

  const remove: NotesStore["remove"] = async (path, stores = []) => {
    await queued(async ({ enqueue }) => {
      if (listing?.files.has(path) !== true) {
        return;
      }
      const base = await heldText(path);
      if (base === null) {
        return;
      }
      const storeBases: { baseOid: string; path: string }[] = [];
      for (const store of stores) {
        const held = listing?.files.has(store) === true ? await heldText(store) : null;
        if (held !== null) {
          storeBases.push({ baseOid: held.oid, path: store });
        }
      }
      await enqueue({ baseOid: base.oid, op: "remove", path, stores: storeBases });
    });
  };

  const putAsset: NotesStore["putAsset"] = async (path, bytes) =>
    await queued(async ({ enqueue }) => {
      if (isTakenHere(path)) {
        return { kind: "exists" };
      }
      // named by the blob, so the same bytes staged twice are one file
      const stagedFile = `${await blobOid(args.sha1, bytes)}${extnamePath(path)}`;
      await outbox.stage(stagedFile, bytes);
      await enqueue({ op: "putAsset", path, size: bytes.length, stagedFile });
      return { kind: "created" };
    });

  // the store's text after the edit, from what the phone holds of it: nothing where it lists none
  const editedStore = async (
    path: string,
    edit: CommentEdit["edit"],
  ): Promise<
    | { kind: "planned"; store: CommentOp["store"] }
    | Extract<CommentEditOutcome, { kind: "refused" }>
  > => {
    const held = listing?.files.has(path) === true ? await heldText(path) : null;
    let base: CommentOp["store"]["base"] = null;
    if (held !== null) {
      if (held.content === null) {
        return { kind: "refused", message: UNREADABLE_COMMENTS };
      }
      base = { content: held.content, oid: held.oid };
    }
    const parsed = base === null ? null : parseSidecar(base.content);
    if (parsed !== null && !parsed.ok) {
      return { kind: "refused", message: `${UNREADABLE_COMMENTS} ${parsed.error}` };
    }
    const edited = edit(parsed?.sidecar ?? {});
    return edited.ok
      ? { kind: "planned", store: { base, content: serializeSidecar(edited.sidecar), path } }
      : { kind: "refused", message: edited.error };
  };

  // read, planned and queued under the write lock, so no write lands between the texts the edit
  // was made from and the row that carries it
  const editComments: NotesStore["editComments"] = async ({ anchor, edit, path }) =>
    await queued(async ({ enqueue }) => {
      const note = goneHere(path) ? null : await heldText(path);
      if (note === null) {
        return { kind: "vanished" };
      }
      if (note.content === null) {
        return { kind: "refused", message: UNREADABLE_NOTE };
      }
      if (anchor !== null && anchor.expected !== note.content) {
        return { current: note.content, kind: "changed" };
      }
      const key = commentKeyOf(
        anchor?.content ?? note.content,
        anchor === null ? null : args.mintNoteId,
      );
      if (key.kind === "refused") {
        return key;
      }
      const planned = await editedStore(commentsStorePath(key.id), edit);
      if (planned.kind === "refused") {
        return planned;
      }
      const { store } = planned;
      const anchored =
        key.content === note.content
          ? null
          : { baseContent: note.content, baseOid: note.oid, content: key.content, path };
      expectOwn(path, key.content);
      expectOwn(store.path, store.content);
      await enqueue({ anchored, op: "comment", store });
      return { kind: "edited", note: key.content };
    });

  return {
    async attachmentFile(path) {
      const current = session.current();
      const entry = listing?.files.get(path);
      if (current.kind !== "live") {
        return { message: NOT_SIGNED_IN, ok: false };
      }
      if (entry === undefined || entry.source.kind === "text") {
        return { message: "This attachment is not in your vault.", ok: false };
      }
      const fence = signIn.fenceFor(current.id);
      try {
        if (entry.source.kind === "staged") {
          const uri = await outbox.stagedUri(entry.source.file);
          return uri === null ? { message: STAGED_FILE_GONE, ok: false } : { ok: true, uri };
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
        return { message: storageMessage(error), ok: false };
      }
    },

    create,

    async drain() {
      await signIn.ready();
      await outbox.drain();
    },

    editComments,

    heldFiles: () =>
      listing === null
        ? []
        : [...listing.files.values()].map((entry) => ({
            aliases: entry.aliases,
            noteId: entry.noteId,
            path: entry.path,
          })),

    async noteTexts() {
      await signIn.ready();
      const listed = listing;
      if (listed === null) {
        return new Map();
      }
      const mirrored = await mirror.readTexts();
      const held = new Map(mirrored.map((text) => [text.path, text]));
      const texts = new Map<string, string>();
      for (const entry of listed.files.values()) {
        if (!isDocPath(entry.path)) {
          continue;
        }
        if (entry.source.kind === "text") {
          texts.set(entry.path, entry.source.text);
        } else if (entry.source.kind === "vault") {
          const text = held.get(entry.source.row.path);
          if (text?.oid === entry.source.row.oid && text.content !== null) {
            texts.set(entry.path, text.content);
          }
        }
      }
      return texts;
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
      const id = commentStoreKey(note.content);
      if (id === null) {
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
      return read.ok ? read : { message: read.message, ok: false };
    },

    async refresh() {
      if (session.current().kind !== "live") {
        return;
      }
      await refreshing.run({
        onError: () => {
          // guarded reports every failure under its own fence
        },
        pass: async () => {
          const current = session.current();
          if (current.kind !== "live") {
            return "fenced";
          }
          await guarded(current);
          return session.fenced(current.id) ? "caught-up" : "fenced";
        },
        repeat: () => session.current().kind === "live",
      });
    },

    remove,

    rename,

    reset(next) {
      signIn.restart(next, { hydrate, wipe });
      listing = null;
      mirrorRows = null;
      tree.set({ state: "idle" });
    },

    tree,

    // counted on disk, so rows a load could not read still ask before a sign-out discards them
    async unsentCount() {
      await signIn.ready();
      return await outbox.unsent();
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
