import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { z } from "zod";

import { recordTurnEdit, undoTurn } from "./turn-log";
import type { TurnCursor, TurnLogRow } from "./turn-log";

// a note's body as @slate-yjs/core lays it out: one root XmlText, each element an XmlText embedded
// in it with the element's props as its attributes
const ROOT = "content";

const paragraph = (text: string): Y.XmlText => {
  const element = new Y.XmlText();
  element.setAttribute("type", "p");
  element.insert(0, text);
  return element;
};

const rootOf = (doc: Y.Doc): Y.XmlText => doc.get(ROOT, Y.XmlText);

const rootDelta = z.array(z.object({ insert: z.instanceof(Y.XmlText) }));

const blocksOf = (doc: Y.Doc): Y.XmlText[] =>
  rootDelta.parse(rootOf(doc).toDelta()).map((op) => op.insert);

const blockOf = (doc: Y.Doc, index: number): Y.XmlText => {
  const block = blocksOf(doc)[index];
  if (block === undefined) {
    throw new RangeError(`no block ${index}`);
  }
  return block;
};

const textOf = (doc: Y.Doc): string[] => blocksOf(doc).map((block) => block.toString());

// the note's object and one person's client on it, synced as its socket would
const noteOf = (...texts: readonly string[]) => {
  const live = new Y.Doc();
  live.transact(() => {
    for (const [index, text] of texts.entries()) {
      rootOf(live).insertEmbed(index, paragraph(text));
    }
  }, "seed");
  const person = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(live, Y.encodeStateAsUpdate(person, Y.encodeStateVector(live)), "person");
    Y.applyUpdate(person, Y.encodeStateAsUpdate(live, Y.encodeStateVector(person)), "note");
  };
  sync();
  return { live, person, sync };
};

// one change set's agent turn on the note's live doc, its log kept as the note would keep it
const turnOn = (live: Y.Doc, changeSetId: string) => {
  const rows: TurnLogRow[] = [];
  let cursor: TurnCursor | null = null;
  const edit = (apply: (root: Y.XmlText) => void) => {
    const recorded = recordTurnEdit(
      live,
      { changeSetId, origin: `agent:thread:${changeSetId}` },
      cursor,
      () => {
        apply(rootOf(live));
      },
    );
    rows.push(...recorded.rows);
    ({ cursor } = recorded);
  };
  return { edit, rows };
};

const undoOn = (live: Y.Doc, rows: readonly TurnLogRow[]) => {
  const undone = undoTurn(rows, live);
  if (undone.update !== null) {
    Y.applyUpdate(live, undone.update, "undo");
  }
  return undone;
};

const storedRow = z.strictObject({
  bytes: z.array(z.number().int().min(0).max(255)).transform((bytes) => new Uint8Array(bytes)),
  changeSetId: z.string(),
  kind: z.enum(["pre", "turn"]),
  part: z.number().int(),
  seq: z.number().int(),
});

const stored = (rows: readonly TurnLogRow[]): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(rows.map((row) => ({ ...row, bytes: [...row.bytes] }))));

const restored = (bytes: Uint8Array): TurnLogRow[] =>
  z.array(storedRow).parse(JSON.parse(new TextDecoder().decode(bytes)));

const docOf = (state: Uint8Array): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};

describe("a turn's undo", () => {
  it("keeps what the person wrote elsewhere, before, between and after the turn's edits", () => {
    const { live, person, sync } = noteOf("One.", "Two.", "Three.");
    blockOf(person, 0).insert(4, " First.");
    sync();
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent one."));
    });
    sync();
    blockOf(person, 2).insert(4, " Mine.");
    sync();
    turn.edit((root) => {
      root.delete(3, 1);
    });
    sync();
    rootOf(person).insertEmbed(3, paragraph("Later."));
    blockOf(person, 0).insert(0, "So: ");
    sync();
    expect(textOf(live)).toStrictEqual(["So: One. First.", "Agent one.", "Two. Mine.", "Later."]);

    expect(undoOn(live, turn.rows).lostText).toBe(false);
    sync();

    expect(textOf(live)).toStrictEqual(["So: One. First.", "Two. Mine.", "Three.", "Later."]);
    expect(textOf(person)).toStrictEqual(textOf(live));
  });

  it("keeps the person's typing inside a paragraph the turn edited in place", () => {
    const { live, person, sync } = noteOf("hello world");
    const turn = turnOn(live, "set-a");
    turn.edit(() => {
      blockOf(live, 0).delete(6, 5);
      blockOf(live, 0).insert(6, "there");
    });
    sync();
    blockOf(person, 0).insert(0, "Oh, ");
    blockOf(person, 0).insert(15, "!");
    sync();
    expect(textOf(live)).toStrictEqual(["Oh, hello there!"]);

    expect(undoOn(live, turn.rows).lostText).toBe(false);

    expect(textOf(live)).toStrictEqual(["Oh, hello world!"]);
  });

  it("flags the person's text inside a block the turn added, which no later write deleted", () => {
    const { live, person, sync } = noteOf("One.");
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent block."));
    });
    sync();
    blockOf(person, 1).insert(12, " Mine.");
    sync();

    expect(undoOn(live, turn.rows).lostText).toBe(true);

    expect(textOf(live)).toStrictEqual(["One."]);
  });

  it("flags what the person typed into the turn's block between two of its edits", () => {
    const { live, person, sync } = noteOf("One.");
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent block."));
    });
    sync();
    blockOf(person, 1).insert(0, "Mine: ");
    sync();
    turn.edit(() => {
      blockOf(live, 0).insert(4, " Plus.");
    });

    expect(undoOn(live, turn.rows).lostText).toBe(true);

    expect(textOf(live)).toStrictEqual(["One."]);
  });

  it("restores what the turn deleted after the person deleted what it added", () => {
    const { live, person, sync } = noteOf("One.", "Two.");
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.delete(1, 1);
      root.insertEmbed(1, paragraph("Agent block."));
    });
    sync();
    rootOf(person).delete(1, 1);
    sync();
    expect(textOf(live)).toStrictEqual(["One."]);

    expect(undoOn(live, turn.rows).lostText).toBe(false);

    expect(textOf(live)).toStrictEqual(["One.", "Two."]);
  });

  it("answers nothing to undo once the person deleted all the turn wrote", () => {
    const { live, person, sync } = noteOf("One.");
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent block."));
    });
    turn.edit(() => {
      blockOf(live, 0).insert(4, " Plus.");
    });
    sync();
    rootOf(person).delete(1, 1);
    blockOf(person, 0).delete(4, 6);
    sync();

    expect(undoTurn(turn.rows, live)).toStrictEqual({ lostText: false, update: null });
  });

  it("undoes from stored bytes alone, the rows in any order", () => {
    const { live, person, sync } = noteOf("hello world", "Two.");
    const turn = turnOn(live, "set-a");
    turn.edit(() => {
      blockOf(live, 0).delete(6, 5);
      blockOf(live, 0).insert(6, "there");
    });
    sync();
    blockOf(person, 1).insert(4, " Mine.");
    sync();
    turn.edit((root) => {
      root.insertEmbed(2, paragraph("Agent block."));
    });
    const log = stored(turn.rows);
    const state = Y.encodeStateAsUpdate(live);

    const woken = docOf(state);
    expect(undoOn(woken, restored(log).toReversed()).lostText).toBe(false);

    expect(textOf(woken)).toStrictEqual(["hello world", "Two. Mine."]);
  });

  it("answers nothing when the turn is undone again, though it deleted text", () => {
    const { live } = noteOf("hello world");
    const turn = turnOn(live, "set-a");
    turn.edit(() => {
      blockOf(live, 0).delete(6, 5);
      blockOf(live, 0).insert(6, "there");
    });
    expect(undoOn(live, turn.rows).update).not.toBeNull();
    expect(textOf(live)).toStrictEqual(["hello world"]);
    const woken = docOf(Y.encodeStateAsUpdate(live));

    expect(undoTurn(turn.rows, woken)).toStrictEqual({ lostText: false, update: null });
    expect(undoTurn(turn.rows, live)).toStrictEqual({ lostText: false, update: null });
  });

  it("undoes the earlier of two turns and keeps the later one's edits, then the later one", () => {
    const { live } = noteOf("One.", "Two.");
    const earlier = turnOn(live, "set-a");
    earlier.edit((root) => {
      root.insertEmbed(1, paragraph("Alpha."));
      blockOf(live, 0).delete(3, 1);
      blockOf(live, 0).insert(3, "!");
    });
    const later = turnOn(live, "set-b");
    later.edit((root) => {
      root.insertEmbed(3, paragraph("Beta."));
      blockOf(live, 0).insert(4, " Yes");
    });
    expect(textOf(live)).toStrictEqual(["One! Yes", "Alpha.", "Two.", "Beta."]);

    expect(undoOn(live, earlier.rows).lostText).toBe(false);
    expect(textOf(live)).toStrictEqual(["One. Yes", "Two.", "Beta."]);

    expect(undoOn(live, later.rows).lostText).toBe(false);
    expect(textOf(live)).toStrictEqual(["One.", "Two."]);
  });

  it("flags a later turn's text typed straight after the earlier turn's inside its block", () => {
    const { live } = noteOf("One.");
    const earlier = turnOn(live, "set-a");
    earlier.edit((root) => {
      root.insertEmbed(1, paragraph("Alpha."));
    });
    const later = turnOn(live, "set-b");
    later.edit(() => {
      blockOf(live, 1).insert(6, " Beta.");
    });
    expect(textOf(live)).toStrictEqual(["One.", "Alpha. Beta."]);

    expect(undoOn(live, earlier.rows).lostText).toBe(true);

    expect(textOf(live)).toStrictEqual(["One."]);
  });

  it("keeps a note past 1 MiB in parts no larger, and undoes from them", () => {
    const long = "lorem ipsum ".repeat(130_000);
    const { live } = noteOf(long);
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent block."));
    });
    const pre = turn.rows.filter((row) => row.kind === "pre");

    expect(pre.map((row) => [row.seq, row.part])).toStrictEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(turn.rows.every((row) => row.bytes.length <= 1024 * 1024)).toBe(true);
    expect(undoOn(live, turn.rows).lostText).toBe(false);
    expect(textOf(live)).toHaveLength(1);
    expect(blockOf(live, 0).toString()).toBe(long);
  });

  it("refuses a log missing a part or holding another change set", () => {
    const { live } = noteOf("lorem ipsum ".repeat(130_000));
    const turn = turnOn(live, "set-a");
    turn.edit((root) => {
      root.insertEmbed(1, paragraph("Agent block."));
    });
    const other = turnOn(live, "set-b");
    other.edit((root) => {
      root.insertEmbed(2, paragraph("Other block."));
    });

    expect(() => undoTurn(turn.rows.slice(1), live)).toThrow(/breaks at update 0 part 1/u);
    expect(() => undoTurn([...turn.rows, ...other.rows], live)).toThrow(/set-a and set-b/u);
  });
});
