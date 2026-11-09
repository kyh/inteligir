// An agent turn's undo, kept as Yjs updates around each of its edits to a note: what the note
// gained since the turn's last edit there (`pre`), then what the edit wrote (`turn`). Undo replays
// them into a fresh doc where a Y.UndoManager tracks the `turn` updates alone, catches that doc up
// to the live note and undoes the turn there, so its answer is a forward edit that keeps every
// later change, save what sat inside a block the turn added.

import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import * as Y from "yjs";

// a Durable Object's SQLite refuses a row past 2 MB, and a note's whole state is one update
const PART_BYTES = 1024 * 1024;

type TurnLogKind = "pre" | "turn";

export interface TurnLogRow {
  readonly changeSetId: string;
  // the update's place in its change set's log
  readonly seq: number;
  // this part's place in its update
  readonly part: number;
  readonly kind: TurnLogKind;
  readonly bytes: Uint8Array;
}

// where a change set's log on a note stands after its last edit there; null before the first
export interface TurnCursor {
  readonly seq: number;
  readonly stateVector: Uint8Array;
}

type TurnUndo =
  | { readonly update: null; readonly lostText: false }
  // lostText: the undo takes away what someone other than the turn wrote inside a block it added
  | { readonly update: Uint8Array; readonly lostText: boolean };

const NOTHING_TO_UNDO: TurnUndo = { lostText: false, update: null };

const TURN = Symbol("turn");

const partsOf = (
  changeSetId: string,
  seq: number,
  kind: TurnLogKind,
  update: Uint8Array,
): TurnLogRow[] =>
  Array.from({ length: Math.max(1, Math.ceil(update.length / PART_BYTES)) }, (_, part) => ({
    bytes: update.slice(part * PART_BYTES, (part + 1) * PART_BYTES),
    changeSetId,
    kind,
    part,
    seq,
  }));

// The edit runs in one transaction under the turn's origin, which a bound editor's own origin must
// equal. Answers the rows to keep and the cursor the turn's next edit to this note takes; it keeps
// nothing itself.
export const recordTurnEdit = (
  doc: Y.Doc,
  turn: { readonly changeSetId: string; readonly origin: unknown },
  cursor: TurnCursor | null,
  apply: () => void,
) => {
  const seq = cursor?.seq ?? 0;
  const pre =
    cursor === null ? Y.encodeStateAsUpdate(doc) : Y.encodeStateAsUpdate(doc, cursor.stateVector);
  const before = Y.encodeStateVector(doc);
  doc.transact(apply, turn.origin);
  return {
    cursor: { seq: seq + 2, stateVector: Y.encodeStateVector(doc) } satisfies TurnCursor,
    rows: [
      ...partsOf(turn.changeSetId, seq, "pre", pre),
      ...partsOf(turn.changeSetId, seq + 1, "turn", Y.encodeStateAsUpdate(doc, before)),
    ],
  };
};

const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
};

const logOf = (rows: readonly TurnLogRow[]) => {
  const changeSetId = rows[0]?.changeSetId;
  if (changeSetId === undefined) {
    return null;
  }
  const updates: { seq: number; kind: TurnLogKind; parts: Uint8Array[] }[] = [];
  for (const row of rows.toSorted((a, b) => a.seq - b.seq || a.part - b.part)) {
    if (row.changeSetId !== changeSetId) {
      throw new Error(`a turn log holds change sets ${changeSetId} and ${row.changeSetId}`);
    }
    const last = updates.at(-1);
    if (row.part === 0 && last?.seq !== row.seq) {
      updates.push({ kind: row.kind, parts: [row.bytes], seq: row.seq });
    } else if (last?.seq === row.seq && last.kind === row.kind && last.parts.length === row.part) {
      last.parts.push(row.bytes);
    } else {
      throw new Error(
        `the turn log of ${changeSetId} breaks at update ${row.seq} part ${row.part}`,
      );
    }
  }
  return {
    changeSetId,
    updates: updates.map(({ kind, parts }) => ({ kind, update: joined(parts) })),
  };
};

// The undo writes as a client its change set names, so a note holding that client's writes has
// had this undo: replayed again, it would restore the turn's deletes a second time.
const undoClient = (changeSetId: string): number => {
  const hash = sha256(utf8ToBytes(changeSetId));
  return new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0);
};

export const undoTurn = (rows: readonly TurnLogRow[], live: Y.Doc): TurnUndo => {
  const log = logOf(rows);
  if (log === null) {
    return NOTHING_TO_UNDO;
  }
  const client = undoClient(log.changeSetId);
  if (Y.decodeStateVector(Y.encodeStateVector(live)).has(client)) {
    return NOTHING_TO_UNDO;
  }
  const replay = new Y.Doc();
  replay.clientID = client;
  // the doc, not the editor's root: the log replays whatever the turn wrote, under any root
  const undoManager = new Y.UndoManager(replay, {
    captureTimeout: Number.POSITIVE_INFINITY,
    trackedOrigins: new Set([TURN]),
  });
  for (const { kind, update } of log.updates) {
    Y.applyUpdate(replay, update, kind === "turn" ? TURN : undefined);
  }
  Y.applyUpdate(replay, Y.encodeStateAsUpdate(live, Y.encodeStateVector(replay)));

  // Undo deletes only what the turn inserted, so anything else it deletes sat inside a type the
  // turn inserted. A count of later deletes misses that: nobody deleted the person's text. A
  // struct's first clock is enough, since the undo splits structs where the turn's insertions end
  // before it deletes, a later write merged onto the turn's text included.
  const inserted = Y.mergeDeleteSets(undoManager.undoStack.map((item) => item.insertions));
  let lostText = false;
  replay.on("afterTransaction", (transaction) => {
    if (transaction.origin !== undoManager) {
      return;
    }
    Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
      lostText ||= !Y.isDeleted(inserted, struct.id);
    });
  });
  let undone = false;
  while (undoManager.canUndo()) {
    undone = undoManager.undo() !== null || undone;
  }
  return undone
    ? { lostText, update: Y.encodeStateAsUpdate(replay, Y.encodeStateVector(live)) }
    : NOTHING_TO_UNDO;
};
