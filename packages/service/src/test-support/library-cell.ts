// A library cell under test: a fresh one per test, opened inside it as its object opens it
// (`../library/open-cell`) over the clock, the bindings and the cap a suite states, its alarm held
// unless the suite asks for the platform's, and items built by hand. The cell is the real Durable
// Object, so every statement meets a SQLite Durable Object's own limits.

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { createRouterClient } from "@orpc/server";
import { heldBody } from "../library/cell-body";
import { readItem } from "../library/library-queries";
import type { StoredItem } from "../library/library-queries";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

import type { CellActor } from "../library/cell-actor";
import { landNew } from "../library/cell-items";
import type { NewItem } from "../library/cell-items";
import { tellSockets } from "../library/cell-sockets";
import type { CellResult } from "../library/cell-refusal";
import { libraryCellName } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { landedSchema, libraryHead } from "../library/library-engine";
import type { LibraryEngine } from "../library/library-engine";
import { libraryRouter } from "../library/library-router";
import { openCell } from "../library/open-cell";

export const newAccountId = (): string => crypto.randomUUID();

export const cellOf = (accountId: string = newAccountId()): DurableObjectStub<LibraryDO> =>
  exports.LibraryDO.getByName(libraryCellName(accountId));

// the time the cell reads, which a test moves by hand
export interface Clock {
  now: number;
}

export const clockAt = (now: number = Date.UTC(2026, 9, 1)): Clock => ({ now });

// what a suite states of its cell; left out, each is the deployment's own
export interface CellUnderTest {
  readonly clock?: Clock;
  readonly env?: Env;
  // what the library may hold
  readonly bytesCap?: number;
  // hears every frame the cell tells the sockets
  readonly frames?: LibrarySocketFrame[];
  // `platform` sets the object's own alarm as each write commits. Left out, the cell holds it: a
  // suite runs the cell's jobs itself, by its own clock, and `alarmAt` says when it would ring
  readonly alarm?: "platform";
}

// the cell as its object opens it, and the library's procedures as the account's laptop calls them
export const cellIn = (state: DurableObjectState, options: CellUnderTest = {}) => {
  const { bytesCap, clock, frames } = options;
  let alarmAt: number | null = null;
  const cell = openCell(state, options.env ?? env, {
    arm:
      options.alarm === "platform"
        ? undefined
        : (at) => {
            alarmAt = at;
          },
    bytesCap,
    now: clock === undefined ? undefined : () => clock.now,
    tell:
      frames === undefined
        ? undefined
        : (frame) => {
            frames.push(frame);
            tellSockets(state, frame);
          },
  });
  const context = cell.contextFor({
    accountId: cell.accountId,
    actor: { door: "page", kind: "session", sessionId: "laptop-1" },
  });
  return {
    ...cell,
    alarmAt: () => alarmAt,
    client: createRouterClient(libraryRouter, { context }),
    context,
  };
};

// the engine inside a fresh cell, its result handed back out
export const inCell = async <T>(
  stub: DurableObjectStub<LibraryDO>,
  run: (state: DurableObjectState, cell: LibraryDO) => T | Promise<T>,
): Promise<T> =>
  await runInDurableObject(stub, async (cell: LibraryDO, state) => await run(state, cell));

export const person = (sessionId = "laptop"): CellActor => ({
  kind: "person",
  label: `You on ${sessionId}`,
  sessionId,
});

// a new item, landed as the library's own procedures land one
export const createItem = (
  library: LibraryEngine,
  actor: CellActor,
  input: NewItem & { readonly opId?: string },
) =>
  library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
    item: landNew(scope, input),
  }));

// an undo of sets that wrote no note's body, so no note has anything to answer first
export const undoFields = (
  library: LibraryEngine,
  actor: CellActor,
  changeSetIds: readonly string[],
) => library.undo(actor, { changeSetIds }, { notes: new Map(), undoSetId: crypto.randomUUID() });

// blocks in the order given, in one section
export const placed = (
  blocks: readonly LibraryBlock[],
  section: LibrarySection = "note",
): { block: LibraryBlock; section: LibrarySection }[] =>
  blocks.map((block) => ({ block, section }));

// the value of a result the test expects to land
export const landedValue = <T>(result: CellResult<T>): T => {
  if (!result.ok) {
    throw new Error(`the cell refused: ${JSON.stringify(result.refusal)}`);
  }
  return result.value;
};

export const refusalOf = <T>(result: CellResult<T>) => {
  if (result.ok) {
    throw new Error(
      `the cell landed what the test expected it to refuse: ${JSON.stringify(result.value)}`,
    );
  }
  return result.refusal;
};

// an item's blocks as the cell's seed holds them, in order; an item whose body went to its note
// holds none here
export const blocksOf = (library: LibraryEngine, itemId: string): LibraryBlock[] => {
  const held = landedValue(library.read((db) => heldBody(db, itemId)));
  if (held?.kind !== "seed") {
    throw new Error(`the cell holds no seed for ${itemId}`);
  }
  return held.blocks.map((stored) => stored.block);
};

// the last sequence number a write took
export const headOf = (library: LibraryEngine): number => landedValue(library.read(libraryHead));

// an item's row as the cell holds it, or null for none
export const storedItemOf = (library: LibraryEngine, itemId: string): StoredItem | null =>
  landedValue(library.read((db) => readItem(db, itemId)));
