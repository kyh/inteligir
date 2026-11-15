// The account's cell as one wake holds it: one handle on its storage, the engine over it with the
// listing it keeps, each item's note, the built-in agent over the library's own procedures, and a
// call's context for whoever it is by. Its Durable Object opens it once a wake and once more for
// each run of its alarm, over the frames that run merges (`./library-do`), and a suite opens it the
// same way inside the cell, over the clock, the cap, the sockets or the alarm it swaps, so no suite
// wires a cell the object does not.

import type { LibrarySocketFrame, MovedFrame } from "@repo/contract/library/library-socket";

import { runAgentTool } from "../agent/agent-tools";
import { turnActorIn } from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import { errorFields } from "../log";
import { noteStub } from "../note/note-stub";
import type { NoteReach } from "../note/note-wire";
import type { CellActor } from "./cell-actor";
import { cellDbOf } from "./cell-db";
import type { CellDb } from "./cell-db";
import { cellIds } from "./cell-ids";
import type { ImportHost } from "./cell-import-host";
import { tellSockets } from "./cell-sockets";
import { cellAccountId } from "./library-cell";
import { openLibraryEngine } from "./library-engine";
import { cellContext } from "./library-orpc";
import type { CellContext } from "./library-orpc";
import { agentPrincipal, cellActorOf, isNamedPrincipal } from "./library-principal";
import type { Principal } from "./library-principal";
import { libraryRouter } from "./library-router";

const STORAGE_CAP = /^[1-9]\d*$/u;

// what one account's library may hold, its change sets included: 1 GiB
const libraryStorageCap = (env: Env): number => {
  const cap = env.LIBRARY_STORAGE_CAP_BYTES;
  if (!STORAGE_CAP.test(cap)) {
    throw new Error(`LIBRARY_STORAGE_CAP_BYTES must be a whole number of bytes, not "${cap}"`);
  }
  return Number(cap);
};

// what a suite or an alarm's run stands in for: the platform's clock, the deployment's cap, the
// sockets every frame goes to, where a write's own goes in their place, and the platform's alarm,
// set to a time or to none
interface CellPorts {
  readonly now?: (() => number) | undefined;
  readonly bytesCap?: number | undefined;
  readonly tell?: ((frame: LibrarySocketFrame) => void) | undefined;
  readonly moved?: ((frame: MovedFrame) => void) | undefined;
  readonly arm?: ((at: number | null) => void) | undefined;
}

// the cell as the agent's turns and an import's runs each need it, and what every door reads
export interface Cell extends AgentCell, ImportHost {
  readonly db: CellDb;
  // each item's note, which this cell alone names for the items its rows hold
  readonly notes: NoteReach;
  // a call's cell, and whom its writes are by
  readonly contextFor: (principal: Principal) => CellContext;
}

// whom a call's writes are by: what its principal names, or for the built-in agent its turn,
// read again as each write lands, which a turn sealed meanwhile refuses
const actorIn = (principal: Principal): ((db: CellDb) => CellActor) => {
  if (isNamedPrincipal(principal)) {
    const actor = cellActorOf(principal);
    return () => actor;
  }
  return (db) => turnActorIn(db, principal.actor);
};

export const openCell = (ctx: DurableObjectState, env: Env, ports: CellPorts = {}): Cell => {
  const accountId = cellAccountId(ctx.id.name);
  const now = ports.now ?? Date.now;
  const db = cellDbOf(ctx.storage);
  const tell =
    ports.tell ??
    ((frame) => {
      tellSockets(ctx, frame);
    });
  const arm =
    ports.arm ??
    ((at) => {
      void (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at));
    });
  const notes: NoteReach = (itemId) => noteStub(ctx.exports, { accountId, itemId });
  // A note whose item went into Deleted or came back closes its sockets, so each dials again
  // through the door, which asks this cell how it opens. Never awaited, so a write answers as it
  // lands: a note that misses it leaves a socket as it was only until that socket's next dial.
  const reopen = async (itemId: string): Promise<void> => {
    try {
      await notes(itemId).reopen();
    } catch (error) {
      console.warn({ event: "note-reopen-unsent", ...errorFields(error) });
    }
  };
  const library = openLibraryEngine({
    bytesCap: ports.bytesCap ?? libraryStorageCap(env),
    // The frame and the alarm are not awaited: storage calls with no await between them commit as
    // one (developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), so
    // a write never stands without the alarm for its jobs, and the output gate holds its frame
    // until both are on disk
    committed: (moved, nextJobAt, reopens) => {
      if (moved !== null) {
        (ports.moved ?? tell)(moved);
      }
      arm(nextJobAt);
      for (const itemId of reopens) {
        void reopen(itemId);
      }
    },
    db,
    ids: cellIds(now),
    now,
  });
  const cell: Cell = {
    accountId,
    contextFor: (principal) => cellContext({ agent: cell, library, notes }, actorIn(principal)),
    db,
    durable: async () => {
      await ctx.storage.sync();
    },
    env,
    exports: ctx.exports,
    library,
    notes,
    now,
    // every tool call the agent runs is one of its turn's, through the library's procedures
    runTool: async (request) =>
      await runAgentTool(
        libraryRouter,
        cell.contextFor(agentPrincipal(accountId, request)),
        request,
      ),
    tell,
  };
  return cell;
};
