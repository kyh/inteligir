// what the phone shows is the mirror with every unsent row laid over it, oldest first: a pending
// edit reads as the note, a create and a staged photo list before the vault holds them, and a
// rename or a delete moves or hides the row now. A parked row is laid over too, since its bytes are
// the user's until they discard them.

import { utf8ByteLength } from "@repo/api/cloud/bytes";
import type { OutboxRow, VaultOp } from "./outbox-ops";
import { noteFactsOf } from "./vault-mirror";
import type { MirrorRow } from "./vault-mirror";

// where an entry's bytes are: a mirror row (under another name while a rename is unsent), a
// note's unsent text, or an attachment's staged file
type EntrySource =
  | { kind: "vault"; row: MirrorRow }
  | { kind: "text"; text: string }
  | { kind: "staged"; file: string };

export interface OverlayEntry {
  path: string;
  size: number;
  noteId: string | null;
  aliases: readonly string[];
  source: EntrySource;
}

const textEntry = (path: string, text: string): OverlayEntry => ({
  ...noteFactsOf(text),
  path,
  size: utf8ByteLength(text),
  source: { kind: "text", text },
});

const lay = (entries: Map<string, OverlayEntry>, op: VaultOp): void => {
  switch (op.op) {
    case "write":
    case "create": {
      entries.set(op.path, textEntry(op.path, op.content));
      return;
    }
    case "remove": {
      entries.delete(op.path);
      return;
    }
    case "putAsset": {
      entries.set(op.path, {
        aliases: [],
        noteId: null,
        path: op.path,
        size: op.size,
        source: { file: op.stagedFile, kind: "staged" },
      });
      return;
    }
    case "rename": {
      const moving = entries.get(op.from);
      entries.delete(op.from);
      if (moving !== undefined) {
        entries.set(op.to, { ...moving, path: op.to });
      } else if (op.baseContent !== null) {
        entries.set(op.to, textEntry(op.to, op.baseContent));
      }
      break;
    }
    // no default
  }
};

export const overlayEntries = (
  mirror: readonly MirrorRow[],
  rows: readonly OutboxRow[],
): OverlayEntry[] => {
  const entries = new Map<string, OverlayEntry>(
    mirror.map((row) => [
      row.path,
      {
        aliases: row.aliases,
        noteId: row.noteId,
        path: row.path,
        size: row.size,
        source: { kind: "vault", row },
      },
    ]),
  );
  if (rows.length === 0) {
    return [...entries.values()];
  }
  for (const row of rows) {
    lay(entries, row.op);
  }
  return [...entries.values()].toSorted((a, b) => (a.path < b.path ? -1 : 1));
};
