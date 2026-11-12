// A library cell under test: a fresh one per test, the engine opened inside it over its own
// storage with a clock the test moves, and items built by hand. The cell is the real Durable
// Object, so every statement meets a SQLite Durable Object's own limits.

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { heldBody } from "../library/cell-body";
import { readItem } from "../library/library-queries";
import type { StoredItem } from "../library/library-queries";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

import { runAgentTool } from "../agent/agent-tools";
import { turnActorOf } from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import type { CellActor } from "../library/cell-actor";
import { cellIds } from "../library/cell-ids";
import { landNew } from "../library/cell-items";
import type { NewItem } from "../library/cell-items";
import { settleCommit } from "../library/cell-library";
import { tellSockets } from "../library/cell-sockets";
import type { CellResult } from "../library/cell-refusal";
import { cellStorageOf } from "../library/cell-storage";
import { cellAccountId, libraryCellName } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { landedSchema, openLibraryEngine } from "../library/library-engine";
import type { LibraryEngine } from "../library/library-engine";
import { noteStub } from "../note/note-stub";
import type { NoteReach } from "../note/note-wire";
import { libraryRouter } from "../library/library-router";

const GiB = 1024 * 1024 * 1024;

export const newAccountId = (): string => crypto.randomUUID();

export const cellOf = (accountId: string = newAccountId()): DurableObjectStub<LibraryDO> =>
  exports.LibraryDO.getByName(libraryCellName(accountId));

// the time the engine reads, which a test moves by hand
export interface Clock {
  now: number;
}

export const clockAt = (now: number = Date.UTC(2026, 9, 1)): Clock => ({ now });

export const engineIn = (state: DurableObjectState, clock: Clock, bytesCap = GiB): LibraryEngine =>
  openLibraryEngine({
    bytesCap,
    ids: cellIds(() => clock.now),
    now: () => clock.now,
    storage: cellStorageOf(state.storage),
  });

// each item's note as the cell under test reaches it
export const notesIn =
  (state: DurableObjectState): NoteReach =>
  (itemId) =>
    noteStub(state.exports, { accountId: cellAccountId(state.id.name), itemId });

// the built-in agent in a cell under test, as the cell makes it (`../library/library-do`): its
// conversations' objects reached through the cell's own `exports`, its sockets, which a test may
// listen on, every tool call run through the library's procedures as the turn's, and the commit's
// follow-up the cell's own. `env` stands in for the deployment's bindings, `clock` for its time
export const agentCellIn = (
  state: DurableObjectState,
  library: LibraryEngine,
  options: {
    readonly clock?: Clock;
    readonly env?: Env;
    readonly frames?: LibrarySocketFrame[];
  } = {},
): AgentCell => {
  const cellEnv = options.env ?? env;
  const settle = async <T>(result: CellResult<T>): Promise<CellResult<T>> =>
    await settleCommit(state, cellEnv, library, result);
  const cell: AgentCell = {
    accountId: cellAccountId(state.id.name),
    env: cellEnv,
    exports: state.exports,
    library,
    now: () => options.clock?.now ?? Date.now(),
    runTool: async (request) =>
      await runAgentTool(
        libraryRouter,
        {
          actor: turnActorOf(library, request),
          agent: cell,
          library,
          notes: notesIn(state),
          settle,
        },
        request,
      ),
    settle,
    tell: (frame) => {
      options.frames?.push(frame);
      tellSockets(state, frame);
    },
  };
  return cell;
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
  const held = landedValue(library.read((storage) => heldBody(storage.db, itemId)));
  if (held?.kind !== "seed") {
    throw new Error(`the cell holds no seed for ${itemId}`);
  }
  return held.blocks.map((stored) => stored.block);
};

// an item's row as the cell holds it, or null for none
export const storedItemOf = (library: LibraryEngine, itemId: string): StoredItem | null =>
  landedValue(library.read((sql) => readItem(sql.db, itemId)));
