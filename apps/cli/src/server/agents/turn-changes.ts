// a turn's changes are read from the log by its trailers, never from a stored sha: a rebase onto
// another device's push rewrites the sha and keeps the message.

import type {
  TurnChanges,
  TurnChangesResponse,
  TurnChangeState,
  UndoKeptPath,
  UndoKeptReason,
  UndoTurnResponse,
} from "@repo/api/local/threads/threads-schema";
import type { DbConnection } from "@repo/db/connection";
import { getThread } from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { DbNotifier } from "@repo/domain/notifier";
import { isThreadRunning } from "@repo/domain/thread-status";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import { revertCommentEntries } from "@repo/notes/comments/revert-entries";
import {
  commentsStoreNoteId,
  commentsStorePath,
  isLegacyCommentsSidecarPath,
  isNoteIdKey,
  legacySidecarNotePath,
  parseSidecar,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type { CommentSidecar } from "@repo/notes/comments/sidecar-schema";
import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { frontmatterId, withFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { revertEdit, turnEditOf } from "@repo/notes/text/revert-edit";
import type { RevertVerdict } from "@repo/notes/text/revert-edit";
import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import type { GitEngine } from "../vault/git-engine";
import type { TurnCommit } from "../vault/git-history";
import { ENGINE_IDENTITY } from "../vault/git-run";
import { undoCommitMessage } from "../vault/turn-trailers";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

// the walk reads committer dates, which are the committing device's clock, and git stops a line of
// history at the first commit older than the bound; a day costs a day's commits and outlasts any
// clock a device keeps in sync.
const CLOCK_SKEW_MARGIN_MS = 24 * 60 * 60 * 1000;

export type ListTurnChanges = (threadId: string) => Promise<TurnChangesResponse | null>;

interface FoldedTurn {
  paths: Set<string>;
  state: TurnChangeState;
}

// oldest first, since the log is read oldest first and a Map keeps its first insertion.
const foldTurnCommits = (commits: readonly TurnCommit[]): TurnChanges[] => {
  const turns = new Map<string, FoldedTurn>();
  for (const commit of commits) {
    switch (commit.trailers.kind) {
      case "turn": {
        const turn = turns.get(commit.trailers.turnId) ?? { paths: new Set(), state: "applied" };
        for (const change of commit.changes) {
          turn.paths.add(change.path);
        }
        turns.set(commit.trailers.turnId, turn);
        break;
      }
      case "undo": {
        const undone = turns.get(commit.trailers.undoesTurnId);
        if (undone !== undefined) {
          undone.state = "undone";
        }
        break;
      }
      // no default
    }
  }
  return [...turns].map(([turnId, turn]) => ({
    paths: [...turn.paths],
    state: turn.state,
    turnId,
  }));
};

// a thread pulled from another device was created here when it arrived, so what that device
// committed before then is not read.
const readThreadTurnCommits = async (git: GitEngine, thread: ThreadRow): Promise<TurnCommit[]> =>
  await git.turnCommits(thread.id, thread.createdAt - CLOCK_SKEW_MARGIN_MS);

interface ListTurnChangesArgs {
  db: DbConnection;
  git: GitEngine;
  threadId: string;
}

// null for a thread this device does not hold.
export const listTurnChanges = async (
  args: ListTurnChangesArgs,
): Promise<TurnChangesResponse | null> => {
  const thread = getThread(args.db, args.threadId);
  if (thread === null) {
    return null;
  }
  return { turns: foldTurnCommits(await readThreadTurnCommits(args.git, thread)) };
};

export type UndoTurnOutcome =
  | { kind: "undone"; changes: UndoTurnResponse }
  | { kind: "not-found"; message: string }
  | { kind: "conflict"; message: string };

export type UndoTurnChanges = (threadId: string, turnId: string) => Promise<UndoTurnOutcome>;

// the trees a path is read at: the parent of the turn's first commit to touch it, and the turn's
// last commit to touch it.
interface PathSpan {
  path: string;
  before: string;
  after: string;
}

const turnSpans = (commits: readonly TurnCommit[], turnId: string): PathSpan[] => {
  const spans = new Map<string, PathSpan>();
  for (const commit of commits) {
    if (commit.trailers.kind !== "turn" || commit.trailers.turnId !== turnId) {
      continue;
    }
    for (const { path } of commit.changes) {
      spans.set(path, {
        after: commit.sha,
        before: spans.get(path)?.before ?? commit.parent,
        path,
      });
    }
  }
  return [...spans.values()];
};

// a comment store is json, which a line merge can leave unparseable, so it is taken back entry by
// entry instead, against the note it anchors in: a store names that note by id, a legacy sidecar
// by path.
type StoreNote = { kind: "id"; noteId: string } | { kind: "path"; notePath: string };

const storeNoteOf = (path: string): StoreNote | null => {
  const noteId = commentsStoreNoteId(path);
  if (noteId !== null) {
    return { kind: "id", noteId };
  }
  return isLegacyCommentsSidecarPath(path)
    ? { kind: "path", notePath: legacySidecarNotePath(path) }
    : null;
};

type ReadSide = { readable: true; text: string | null } | { readable: false };

// the vault and git hand bytes over decoded as utf-8, so bytes that are not text arrive holding a
// replacement character or a nul, and writing them back would corrupt the file.
const isText = (text: string): boolean => !text.includes("\0") && !text.includes("\uFFFD");

const readSide = async (read: () => Promise<string>): Promise<ReadSide> => {
  try {
    const text = await read();
    return isText(text) ? { readable: true, text } : { readable: false };
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return { readable: true, text: null };
    }
    // over the read cap, or a symlink planted at the path since.
    if (
      (error instanceof VaultServiceError && error.code === "too_large") ||
      error instanceof VaultPathError
    ) {
      return { readable: false };
    }
    throw error;
  }
};

type RevertService = Pick<
  VaultService,
  "read" | "removeIfUnchanged" | "statEntry" | "writeGuarded" | "writeIfUnchanged"
>;

const readCurrent = async (service: RevertService, path: string): Promise<ReadSide> =>
  await readSide(async () => {
    const { content } = await service.read(path);
    return content;
  });

interface SpanSides {
  before: string | null;
  after: string | null;
  current: string | null;
}

// null when a side is not text the undo can merge
const readSpan = async (
  git: GitEngine,
  service: RevertService,
  span: PathSpan,
): Promise<SpanSides | null> => {
  const [before, after, current] = await Promise.all([
    readSide(async () => await git.revision(span.path, span.before)),
    readSide(async () => await git.revision(span.path, span.after)),
    readCurrent(service, span.path),
  ]);
  if (!before.readable || !after.readable || !current.readable) {
    return null;
  }
  return { after: after.text, before: before.text, current: current.text };
};

type ParsedStore = { ok: true; sidecar: CommentSidecar | null } | { ok: false };

const parseStore = (text: string | null): ParsedStore => {
  if (text === null) {
    return { ok: true, sidecar: null };
  }
  const parsed = parseSidecar(text);
  return parsed.ok ? parsed : { ok: false };
};

// every marker id across the notes once their own reverts have landed; null when one cannot be
// read or parsed, since calling a marker gone from it would be a guess.
const markerIdsIn = async (
  service: RevertService,
  notePaths: readonly string[],
): Promise<Set<string> | null> => {
  const ids = new Set<string>();
  for (const notePath of notePaths) {
    const note = await readCurrent(service, notePath);
    if (!note.readable) {
      return null;
    }
    if (note.text === null) {
      continue;
    }
    const markers = markerRootIds(note.text);
    if (markers === null) {
      return null;
    }
    for (const id of markers) {
      ids.add(id);
    }
  }
  return ids;
};

type LandableVerdict = Exclude<RevertVerdict, { kind: "unchanged" } | { kind: "keep" }>;

// null: nothing to write
const storeVerdict = (
  current: string | null,
  sidecar: CommentSidecar | null,
): LandableVerdict | null => {
  if (current === null) {
    return sidecar === null ? null : { content: serializeSidecar(sidecar), kind: "recreate" };
  }
  return sidecar === null
    ? { expected: current, kind: "remove" }
    : { content: serializeSidecar(sidecar), expected: current, kind: "write" };
};

// the id a change wrote into a note that had none, when it can key a store
const idMintedBy = (before: string | null, after: string | null): string | null => {
  if (before === null || after === null || frontmatterId(before) !== null) {
    return null;
  }
  const id = frontmatterId(after);
  return id !== null && isNoteIdKey(id) ? id : null;
};

type Landed =
  | { kind: "reverted" }
  | { kind: "kept"; reason: UndoKeptReason }
  // the path is already where the undo would take it: the note the turn made is gone
  | { kind: "already-there" };

// every write is the vault's own compare-and-swap, so a path that changed after its verdict was
// read is kept and named, never overwritten.
const landVerdict = async (
  service: RevertService,
  path: string,
  verdict: LandableVerdict,
): Promise<Landed> => {
  switch (verdict.kind) {
    case "write": {
      const written = await service.writeIfUnchanged(path, verdict.expected, verdict.content);
      if (written.applied) {
        return { kind: "reverted" };
      }
      return {
        kind: "kept",
        reason: written.reason === "changed" ? "edited-since" : "deleted-since",
      };
    }
    case "remove": {
      const removed = await service.removeIfUnchanged(path, verdict.expected);
      if (removed.applied) {
        return { kind: "reverted" };
      }
      return removed.reason === "changed"
        ? { kind: "kept", reason: "edited-since" }
        : { kind: "already-there" };
    }
    case "recreate": {
      try {
        const created = await service.writeGuarded(path, verdict.content, { kind: "absent" });
        return created.applied ? { kind: "reverted" } : { kind: "kept", reason: "recreated-since" };
      } catch (error) {
        // a folder now stands at the path, or a file where one of its folders must be.
        if (error instanceof VaultServiceError && error.code === "conflict") {
          return { kind: "kept", reason: "recreated-since" };
        }
        throw error;
      }
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
};

// one undo's reads and writes, and what it reports
interface UndoPass {
  git: GitEngine;
  service: RevertService;
  busy: ReadonlySet<string>;
  claim: (paths: readonly string[]) => void;
  reverted: string[];
  kept: UndoKeptPath[];
  // a store taken back only in part is reported kept, and is committed all the same
  written: Set<string>;
  // each id the turn minted into a note whose revert took it back, and that note
  minted: Map<string, string>;
}

// null once the path is named kept
const sidesToRevert = async (pass: UndoPass, span: PathSpan): Promise<SpanSides | null> => {
  if (pass.busy.has(span.path)) {
    pass.kept.push({ path: span.path, reason: "busy" });
    return null;
  }
  const sides = await readSpan(pass.git, pass.service, span);
  if (sides === null) {
    pass.kept.push({ path: span.path, reason: "unreadable" });
  }
  return sides;
};

// `partial`: the verdict leaves part of the turn's change in place, so a landed write still
// names the path kept. answers whether the write landed.
const land = async (
  pass: UndoPass,
  path: string,
  verdict: LandableVerdict,
  partial: boolean,
): Promise<boolean> => {
  pass.claim([path]);
  const landed = await landVerdict(pass.service, path, verdict);
  if (landed.kind === "kept") {
    pass.kept.push({ path, reason: landed.reason });
  }
  if (landed.kind !== "reverted") {
    return false;
  }
  pass.written.add(path);
  if (partial) {
    pass.kept.push({ path, reason: "edited-since" });
  } else {
    pass.reverted.push(path);
  }
  return true;
};

const revertNote = async (pass: UndoPass, span: PathSpan): Promise<void> => {
  const sides = await sidesToRevert(pass, span);
  if (sides === null) {
    return;
  }
  const edit = turnEditOf(sides.before, sides.after);
  if (edit === null) {
    return;
  }
  const verdict = revertEdit({ ...edit, current: sides.current });
  if (verdict.kind === "unchanged") {
    return;
  }
  if (verdict.kind === "keep") {
    pass.kept.push({ path: span.path, reason: verdict.reason });
    return;
  }
  const noteId = idMintedBy(sides.before, sides.after);
  if ((await land(pass, span.path, verdict, false)) && noteId !== null) {
    pass.minted.set(noteId, span.path);
  }
};

const revertStore = async (
  pass: UndoPass,
  knowledge: Pick<KnowledgeRuntime, "noteIdOwners">,
  span: PathSpan,
  note: StoreNote,
): Promise<void> => {
  const sides = await sidesToRevert(pass, span);
  if (sides === null) {
    return;
  }
  // gone since with its note: entries brought back would anchor in nothing
  if (sides.current === null && sides.after !== null) {
    if (sides.before !== null) {
      pass.kept.push({ path: span.path, reason: "deleted-since" });
    }
    return;
  }
  const before = parseStore(sides.before);
  const after = parseStore(sides.after);
  const current = parseStore(sides.current);
  if (!before.ok || !after.ok || !current.ok) {
    pass.kept.push({ path: span.path, reason: "unreadable" });
    return;
  }
  const notePaths =
    note.kind === "id" ? await knowledge.noteIdOwners(note.noteId) : [note.notePath];
  const entries = revertCommentEntries({
    after: after.sidecar,
    before: before.sidecar,
    current: current.sidecar,
    markerIds: await markerIdsIn(pass.service, notePaths),
  });
  const verdict = entries.kind === "reverted" ? storeVerdict(sides.current, entries.sidecar) : null;
  if (verdict !== null) {
    await land(pass, span.path, verdict, entries.kept);
  } else if (entries.kept) {
    pass.kept.push({ path: span.path, reason: "edited-since" });
  }
};

// the comments list finds a store by its note's id alone, so a note whose revert took back the id
// the turn minted takes it again while a store keyed by it is still there.
const refileMintedIds = async (pass: UndoPass): Promise<void> => {
  for (const [noteId, notePath] of pass.minted) {
    if ((await pass.service.statEntry(commentsStorePath(noteId))) !== "file") {
      continue;
    }
    const now = await readCurrent(pass.service, notePath);
    if (!now.readable || now.text === null) {
      continue;
    }
    const withId = withFrontmatterId(now.text, noteId);
    if (withId.kind !== "written") {
      continue;
    }
    const rewritten = await pass.service.writeIfUnchanged(notePath, now.text, withId.content);
    if (rewritten.applied) {
      pass.written.add(notePath);
    }
  }
};

interface UndoTurnArgs {
  db: DbConnection;
  git: GitEngine;
  knowledge: Pick<KnowledgeRuntime, "noteIdOwners">;
  service: RevertService;
  notifier: DbNotifier;
  threadId: string;
  turnId: string;
}

// through the vault's own writes, so the re-index, the bus and an open buffer hear the undo like
// any other edit, which git revert would bypass; and three-way, since a byte restore to the
// turn's parent would drop every edit made since. nothing hands the writes to a running turn, so
// an agent undoing an earlier turn from inside a later one does not commit the undo as its own.
// comment stores go after the notes, because whether an entry the turn added may go depends on
// the markers its note carries once the note's own revert has landed.
export const undoTurnChanges = async (args: UndoTurnArgs): Promise<UndoTurnOutcome> => {
  const { git, service, threadId, turnId } = args;
  const thread = getThread(args.db, threadId);
  if (thread === null) {
    return { kind: "not-found", message: "Thread not found" };
  }
  if (thread.activeTurnId === turnId && isThreadRunning(thread.status)) {
    return { kind: "conflict", message: `Turn ${turnId} is still running` };
  }
  // held from the first read, so neither the auto-commit nor a sync pass sweeps the undo's
  // writes into a commit that does not name the turn it undoes.
  const hold = git.holdCommits();
  try {
    // a turn settles before its commit lands, and that commit is already queued on the repo lock.
    await git.runExclusive(async () => {
      await Promise.resolve();
    });
    const commits = await readThreadTurnCommits(git, thread);
    const turn = foldTurnCommits(commits).find((folded) => folded.turnId === turnId);
    if (turn === undefined) {
      return { kind: "not-found", message: `No change of turn ${turnId} is recorded here` };
    }
    if (turn.state === "undone") {
      return { kind: "conflict", message: `Turn ${turnId} was already undone` };
    }

    const pass: UndoPass = {
      busy: new Set(git.claimedPaths()),
      claim: (paths) => {
        hold.claim(paths);
      },
      git,
      kept: [],
      minted: new Map(),
      reverted: [],
      service,
      written: new Set(),
    };
    const stores: { span: PathSpan; note: StoreNote }[] = [];
    for (const span of turnSpans(commits, turnId)) {
      const note = storeNoteOf(span.path);
      if (note === null) {
        await revertNote(pass, span);
      } else {
        stores.push({ note, span });
      }
    }
    for (const { span, note } of stores) {
      await revertStore(pass, args.knowledge, span, note);
    }
    await refileMintedIds(pass);

    const committed = await git.commitPaths(
      [...pass.written],
      ENGINE_IDENTITY,
      undoCommitMessage(threadId, turnId),
    );
    if (committed !== null) {
      args.notifier.notifyThread(threadId, ["changes-committed"]);
    }
    return { changes: { kept: pass.kept, reverted: pass.reverted }, kind: "undone" };
  } finally {
    hold.release();
  }
};
