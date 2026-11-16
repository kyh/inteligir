// A library cell under test: a fresh one per test, opened inside it as its object opens it
// (`../library/open-cell`) over the clock, the bindings and the cap a suite states, its alarm held
// unless the suite asks for the platform's, items built by hand, and the built-in agent's turns
// opened and ended as its conversations open and end them. The cell is the real Durable Object, so
// every statement meets a SQLite Durable Object's own limits.

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { createRouterClient } from "@orpc/server";
import { heldBody } from "../library/cell-body";
import { readItem } from "../library/library-queries";
import type { StoredItem } from "../library/library-queries";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { changeSets } from "@repo/db/cell/schema";
import { landPush } from "../agent/agent-turns";
import { createThread, insertTurn, restatus } from "../agent/turn-rows";
import type { CellActor, TurnActor } from "../library/cell-actor";
import { landNew } from "../library/cell-items";
import type { NewItem } from "../library/cell-items";
import { tellSockets } from "../library/cell-sockets";
import type { CellResult } from "../library/cell-refusal";
import { libraryCellName } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { landedSchema, libraryHead } from "../library/library-engine";
import type { LibraryEngine } from "../library/library-engine";
import { agentPrincipal } from "../library/library-principal";
import { libraryRouter } from "../library/library-router";
import { openCell } from "../library/open-cell";
import type { Cell } from "../library/open-cell";

export const newAccountId = (): string => crypto.randomUUID();

export const cellOf = (accountId: string = newAccountId()): DurableObjectStub<LibraryDO> =>
  exports.LibraryDO.getByName(libraryCellName(accountId));

// the time the cell reads, which a test moves by hand
export interface Clock {
  now: number;
}

export const clockAt = (now: number = Date.UTC(2026, 9, 1)): Clock => ({ now });

// what a suite states of its cell; left out, each but the alarm is the deployment's own
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

export const PERSON: CellActor = { kind: "person" };

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
export const undoFields = (library: LibraryEngine, changeSetIds: readonly string[]) =>
  library.undo({ changeSetIds }, new Map());

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

const TURN_TEXT = "A turn under test.";

// A turn of the built-in agent in a thread of its own, opened in the cell as a send opens one: whom
// its writes are by, the library's procedures as its tool calls reach them, the push that ends it
// landed as its conversation's object sends it, and the change set its writes joined.
export const openTurn = (cell: Cell) => {
  const threadId = crypto.randomUUID();
  const actor: TurnActor = { kind: "agent", threadId, turn: 1 };
  landedValue(
    cell.library.landApart({ answer: z.object({}), opId: undefined }, (scope) => {
      createThread(scope, threadId, TURN_TEXT);
      insertTurn(scope.db, {
        at: scope.now,
        message: { text: TURN_TEXT, viewContext: null },
        threadId,
        turn: actor.turn,
      });
      restatus(scope, threadId);
      return {};
    }),
  );
  return {
    actor,
    client: createRouterClient(libraryRouter, {
      context: cell.contextFor(agentPrincipal(cell.accountId, actor)),
    }),
    end: (): void => {
      const ended = landPush(cell, {
        events: [{ reason: "done", turn: actor.turn, type: "turn.ended" }],
        seq: 1,
        threadId,
        turn: actor.turn,
      });
      if (!ended.ok) {
        throw new Error(`the cell landed no end of the turn: ${ended.refusal}`);
      }
    },
    setId: (): string =>
      z
        .string()
        .parse(
          landedValue(
            cell.library.read(
              (db) =>
                db
                  .select({ id: changeSets.id })
                  .from(changeSets)
                  .where(eq(changeSets.threadId, threadId))
                  .get()?.id,
            ),
          ),
        ),
  };
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
