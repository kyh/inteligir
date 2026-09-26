// a row the vault refused as stale, settled with the desktop's own verdict: `reconcileFile` from
// @repo/notes decides what each path holds and names any copy, and this module only turns its
// answer into the one change set the phone sends next. Every round reconciles the row's intent
// against the newest conflict, so a head that moved again is met again.

import type { CloudFailure } from "@repo/api/cloud/client";
import { utf8ByteLength } from "@repo/api/cloud/bytes";
import { vaultCollisionKey } from "@repo/api/cloud/vault/vault-commit-schema";
import type {
  VaultChangeRequest,
  VaultCommitConflict,
  VaultConflictReason,
} from "@repo/api/cloud/vault/vault-commit-schema";
import { isCommentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";
import { reconcileFile } from "@repo/notes/sync/reconcile-file";
import type { FileSide, Reconciled } from "@repo/notes/sync/reconcile-file";
import { putText, rebaseEdit, rewritePuts } from "./outbox-ops";
import type { OutboxRow, RenameOp, Settle, TextOp, VaultOp, VaultSide } from "./outbox-ops";
import type { MirrorLanding } from "./vault-mirror";

type VaultConflict = VaultCommitConflict["conflicts"][number];

type TextRead =
  | { kind: "text"; text: string }
  | { kind: "opaque" }
  | { kind: "failed"; failure: CloudFailure };

export interface ReconcileContext {
  thisDevice: string;
  // asked of each candidate copy name; answers ignoring case, as a Mac's disk does
  isTaken: (path: string) => boolean;
  // what a path holds at the conflict's head, for a note too large to ride the conflict inline
  readText: (path: string, head: string) => Promise<TextRead>;
}

// `send`: the set to send next, kept on the row so a resend after a lost answer is the same set.
// `local`: the vault already holds the answer, so nothing is sent. `retarget`: the row's own change
// again, over what the vault holds now: a rename moves the version there and leaves out the links
// it could not rewrite (`unlinked` names the notes another device changed first), a delete takes
// the comment stores as they are now.
export type Resolution =
  | { kind: "send"; settle: Settle }
  | {
      kind: "local";
      landings: readonly MirrorLanding[];
      reports: readonly SyncConflictReport[];
    }
  | { kind: "retarget"; op: VaultOp; unlinked: readonly string[] }
  | { kind: "park"; reason: string }
  | { kind: "failed"; failure: CloudFailure };

const ABSENT: FileSide = { kind: "absent" };

// no resend settles these: the vault would refuse the same change the same way
const PARKED_REASONS: ReadonlyMap<VaultConflictReason, string> = new Map([
  ["blocked", "Something else in your vault already has this name."],
  ["case-collision", "Another note has this name in different capitals."],
  ["unwritable", "This file cannot be changed from your phone."],
]);

const NOT_KEPT_HERE = "Both versions could not be kept on your phone. Try again from your Mac.";

const parked = (reason: string): Resolution => ({ kind: "park", reason });

const refusedFor = (conflicts: readonly VaultConflict[]): string | null => {
  for (const entry of conflicts) {
    const reason = PARKED_REASONS.get(entry.reason);
    if (reason !== undefined) {
      return reason;
    }
  }
  return null;
};

const holdsText = (path: string): boolean => isDocPath(path) || isCommentsStorePath(path);

// `device` wrote what the path holds, its deletion included
type Theirs =
  | { kind: "absent"; device: string | null }
  | { kind: "present"; side: VaultSide; file: FileSide }
  | { kind: "failed"; failure: CloudFailure };

const fileOf = (side: VaultSide): FileSide =>
  side.text === null ? { kind: "opaque", ref: side.oid } : { kind: "text", text: side.text };

const deviceOf = (theirs: Exclude<Theirs, { kind: "failed" }>): string =>
  (theirs.kind === "present" ? theirs.side.device : theirs.device) ?? "";

// what the path held when the set was reconciled, for a round the path itself did not conflict in
const heldSide = (held: VaultSide | null): Theirs =>
  held === null
    ? { device: null, kind: "absent" }
    : { file: fileOf(held), kind: "present", side: held };

const theirsAt = async (
  entry: VaultConflict,
  head: string,
  ctx: ReconcileContext,
): Promise<Theirs> => {
  if (entry.current === null) {
    return { device: entry.device, kind: "absent" };
  }
  const base = { commit: head, device: entry.device, oid: entry.current.oid, path: entry.path };
  let text = entry.current.content ?? null;
  if (text === null && holdsText(entry.path)) {
    const read = await ctx.readText(entry.path, head);
    if (read.kind === "failed") {
      return read;
    }
    text = read.kind === "text" ? read.text : null;
  }
  const side = { ...base, text };
  return { file: fileOf(side), kind: "present", side };
};

const takenBeside = (
  ctx: ReconcileContext,
  conflict: VaultCommitConflict,
): ((path: string) => boolean) => {
  const named = new Set(conflict.conflicts.map((entry) => vaultCollisionKey(entry.path)));
  return (path) => ctx.isTaken(path) || named.has(vaultCollisionKey(path));
};

// what the mirror holds at a path the vault keeps as it is
export const keptLanding = (path: string, against: VaultSide | null): MirrorLanding | null => {
  if (against === null) {
    return { kind: "remove", path };
  }
  if (against.text === null) {
    return null;
  }
  return {
    commit: against.commit,
    kind: "put",
    oid: against.oid,
    path,
    size: utf8ByteLength(against.text),
    text: against.text,
  };
};

// the path's own change, then the copy of theirs beside it
const changesFor = (
  path: string,
  verdict: Reconciled,
  against: VaultSide | null,
  mine: string,
): VaultChangeRequest[] | null => {
  const base = against?.oid ?? null;
  const changes: VaultChangeRequest[] = [];
  switch (verdict.stays.kind) {
    case "mine": {
      changes.push(putText(path, base, mine));
      break;
    }
    case "merged": {
      changes.push(putText(path, base, verdict.stays.text));
      break;
    }
    case "delete": {
      if (against !== null) {
        changes.push({ base: against.oid, op: "delete", path });
      }
      break;
    }
    case "theirs": {
      break;
    }
    // no default
  }
  if (verdict.copy !== null) {
    if (verdict.copy.kind === "opaque") {
      return null;
    }
    changes.push(putText(verdict.copy.path, null, verdict.copy.text));
  }
  return changes;
};

const settled = (
  path: string,
  verdict: Reconciled,
  against: VaultSide | null,
  changes: VaultChangeRequest[],
  mine: string | null,
): Resolution => {
  const reports = verdict.report === null ? [] : [verdict.report];
  const [first, ...rest] = changes;
  if (first === undefined) {
    const kept = keptLanding(path, against);
    return { kind: "local", landings: kept === null ? [] : [kept], reports };
  }
  return { kind: "send", settle: { against, changes: [first, ...rest], mine, reports } };
};

// a write whose path the vault moved on, a create over a taken name, a note deleted elsewhere
// (the edit beats the delete): the vault's version is theirs, the row's text mine
const reconcileText = async (
  row: OutboxRow,
  op: TextOp,
  conflict: VaultCommitConflict,
  ctx: ReconcileContext,
): Promise<Resolution> => {
  const entry = conflict.conflicts.find((candidate) => candidate.path === op.path);
  // only the copy's name was taken: the path still holds what the set was reconciled against
  const held = row.settle?.against ?? null;
  const theirs = entry === undefined ? heldSide(held) : await theirsAt(entry, conflict.head, ctx);
  if (theirs.kind === "failed") {
    return theirs;
  }
  const against = theirs.kind === "present" ? theirs.side : null;
  const verdict = reconcileFile({
    base: op.op === "write" ? { kind: "text", text: op.baseContent } : ABSENT,
    isTaken: takenBeside(ctx, conflict),
    mine: { kind: "text", text: op.content },
    path: op.path,
    theirDevice: deviceOf(theirs),
    theirs: theirs.kind === "present" ? theirs.file : ABSENT,
    thisDevice: ctx.thisDevice,
  });
  const changes = changesFor(op.path, verdict, against, op.content);
  return changes === null
    ? parked(NOT_KEPT_HERE)
    : settled(op.path, verdict, against, changes, op.content);
};

// a delete of a note another device edited keeps the edit, and its comment stores with it; a
// comment store or a dot-entry gets whatever reconcileFile answers for it. A store another device
// wrote since still goes with a note that goes, as the server takes it whatever it holds.
const reconcileRemove = async (
  op: Extract<VaultOp, { op: "remove" }>,
  conflict: VaultCommitConflict,
  ctx: ReconcileContext,
): Promise<Resolution> => {
  const byPath = new Map(conflict.conflicts.map((entry) => [entry.path, entry]));
  const stores = op.stores.flatMap((store) => {
    const current = byPath.get(store.path)?.current;
    if (current === undefined) {
      return [store];
    }
    return current === null ? [] : [{ ...store, baseOid: current.oid }];
  });
  const entry = byPath.get(op.path);
  if (entry === undefined) {
    return op.stores.some((store) => byPath.has(store.path))
      ? { kind: "retarget", op: { ...op, stores }, unlinked: [] }
      : parked(NOT_KEPT_HERE);
  }
  const theirs = await theirsAt(entry, conflict.head, ctx);
  if (theirs.kind === "failed") {
    return theirs;
  }
  const against = theirs.kind === "present" ? theirs.side : null;
  const verdict = reconcileFile({
    base: { kind: "opaque", ref: op.baseOid },
    isTaken: takenBeside(ctx, conflict),
    mine: ABSENT,
    path: op.path,
    theirDevice: deviceOf(theirs),
    theirs: theirs.kind === "present" ? theirs.file : ABSENT,
    thisDevice: ctx.thisDevice,
  });
  const changes: VaultChangeRequest[] = [];
  if (verdict.stays.kind === "delete") {
    if (against !== null) {
      changes.push({ base: against.oid, op: "delete", path: op.path });
    }
    for (const store of stores) {
      changes.push({ base: store.baseOid, op: "delete", path: store.path });
    }
  }
  return settled(op.path, verdict, against, changes, null);
};

// the note's own edit (its alias, its own links) carried onto the version another device left;
// dropped where the two changed the same lines, so the note moves as that device left it
const carriedContent = (op: RenameOp, theirs: string | null): string | null =>
  op.content === null || op.baseContent === null || theirs === null
    ? null
    : rebaseEdit(op.baseContent, op.content, theirs);

// the rename again without the rewrites the vault refused, over the source as it is now
const retargetRename = async (
  op: RenameOp,
  byPath: ReadonlyMap<string, VaultConflict>,
  head: string,
  ctx: ReconcileContext,
): Promise<Resolution> => {
  const kept: RenameOp = {
    ...op,
    rewrites: op.rewrites.filter((rewrite) => !byPath.has(rewrite.path)),
  };
  // a note deleted since has no link left to name
  const unlinked = op.rewrites
    .filter((rewrite) => {
      const entry = byPath.get(rewrite.path);
      return entry !== undefined && entry.current !== null;
    })
    .map((rewrite) => rewrite.path);
  const source = byPath.get(op.from);
  if (source?.reason !== "changed") {
    return { kind: "retarget", op: kept, unlinked };
  }
  const theirs = await theirsAt(source, head, ctx);
  if (theirs.kind === "failed") {
    return theirs;
  }
  if (theirs.kind === "absent") {
    return parked(NOT_KEPT_HERE);
  }
  return {
    kind: "retarget",
    op: {
      ...kept,
      baseContent: theirs.side.text,
      baseOid: theirs.side.oid,
      content: carriedContent(op, theirs.side.text),
    },
    unlinked,
  };
};

// a rename changes no bytes but its own note's and the links it rewrites. A source another device
// edited moves as it is now, and a note whose link it rewrites that another device changed first
// keeps its bytes and is named, both in one round; a name taken meanwhile is the two notes meeting
// at one path, reconciled like a create there, with the rewrites still in the set.
const reconcileRename = async (
  row: OutboxRow,
  op: RenameOp,
  conflict: VaultCommitConflict,
  ctx: ReconcileContext,
): Promise<Resolution> => {
  const byPath = new Map(conflict.conflicts.map((entry) => [entry.path, entry]));
  const rewritten = new Set(op.rewrites.map((rewrite) => rewrite.path));
  const refusal = refusedFor(conflict.conflicts.filter((entry) => !rewritten.has(entry.path)));
  if (refusal !== null) {
    return parked(refusal);
  }
  const source = byPath.get(op.from);
  if (op.rewrites.some((rewrite) => byPath.has(rewrite.path)) || source?.reason === "changed") {
    return await retargetRename(op, byPath, conflict.head, ctx);
  }
  const noteText = op.content ?? op.baseContent;
  if (noteText === null) {
    return parked(NOT_KEPT_HERE);
  }
  const destination = byPath.get(op.to);
  const held = row.settle?.against ?? null;
  const theirs =
    destination === undefined ? heldSide(held) : await theirsAt(destination, conflict.head, ctx);
  if (theirs.kind === "failed") {
    return theirs;
  }
  const against = theirs.kind === "present" ? theirs.side : null;
  const verdict = reconcileFile({
    base: ABSENT,
    isTaken: takenBeside(ctx, conflict),
    mine: { kind: "text", text: noteText },
    path: op.to,
    theirDevice: deviceOf(theirs),
    theirs: theirs.kind === "present" ? theirs.file : ABSENT,
    thisDevice: ctx.thisDevice,
  });
  const changes = changesFor(op.to, verdict, against, noteText);
  if (changes === null) {
    return parked(NOT_KEPT_HERE);
  }
  // a source already gone was deleted or moved elsewhere; the note stays at its new name
  const sourceGone = source?.reason === "missing";
  const moved: VaultChangeRequest[] = sourceGone
    ? [...changes, ...rewritePuts(op)]
    : [{ base: op.baseOid, op: "delete", path: op.from }, ...changes, ...rewritePuts(op)];
  const resolution = settled(op.to, verdict, against, moved, null);
  if (resolution.kind === "local" && sourceGone) {
    return { ...resolution, landings: [...resolution.landings, { kind: "remove", path: op.from }] };
  }
  return resolution;
};

export const resolveConflict = async (
  row: OutboxRow,
  conflict: VaultCommitConflict,
  ctx: ReconcileContext,
): Promise<Resolution> => {
  const { op } = row;
  // a note a rename could not rewrite costs its link, never the rename
  if (op.op === "rename") {
    return await reconcileRename(row, op, conflict, ctx);
  }
  const refusal = refusedFor(conflict.conflicts);
  if (refusal !== null) {
    return parked(refusal);
  }
  switch (op.op) {
    case "write":
    case "create": {
      return await reconcileText(row, op, conflict, ctx);
    }
    case "remove": {
      return await reconcileRemove(op, conflict, ctx);
    }
    case "putAsset": {
      return parked("A file with this name is already in your vault.");
    }
    // no default
  }
};
