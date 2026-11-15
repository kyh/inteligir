// A library call inside the account's cell: the implementer every row's handler is built on, and
// the context a handler works in. Its verbs run the engine for whoever the call is by and answer
// the value, or throw the error the row declares (`@repo/contract/v1/errors`). A refusal is thrown
// inside a transaction, caught at its edge as a value, and thrown again here, the one place that
// says which error each kind is.

import { ORPCError, implement } from "@orpc/server";
import type { LibraryIndex, ListingRow } from "@repo/contract/library/library-index";
import {
  AccountGoneError,
  AgentBudgetError,
  AgentUnavailableError,
  AlreadyUndoneError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
} from "@repo/contract/v1/errors";
import type { z } from "zod";

import type { AgentCell } from "../agent/agent-turns";
import { libraryTools } from "../connector/library-tools";
import type { NoteReach } from "../note/note-wire";
import type { CellActor } from "./cell-actor";
import type { CellDb } from "./cell-db";
import type { LandingScope } from "./cell-landing";
import type { CellRefusal, CellResult } from "./cell-refusal";
import type { Built, LibraryEngine, WriteRequest } from "./library-engine";

export interface CellContext {
  // the engine itself, for a write no verb shapes: an undo, a purge, one that waits on a note
  readonly library: LibraryEngine;
  // the built-in agent's turns, which `library.agent.*` asks of
  readonly agent: AgentCell;
  // each item's note, which every read and write of a body opened there goes through
  readonly notes: NoteReach;
  // whom this call's writes are by, read at the moment a write lands: the built-in agent's is its
  // turn, and refused once that turn is no longer open
  readonly actor: () => CellActor;
  readonly read: <T>(work: (db: CellDb) => T) => T;
  // a read over the listing, caught up to the library's head
  readonly readListing: <T>(work: (listing: LibraryIndex<ListingRow>, db: CellDb) => T) => T;
  // a write by the call's actor, joining its change set
  readonly land: <S extends z.ZodType>(
    request: WriteRequest<S>,
    work: (scope: LandingScope, actor: CellActor) => Built<z.input<S>>,
  ) => z.output<S>;
  // a write that touches no item, so joins no set: a folder, an import's job, the filing rules
  readonly landApart: <S extends z.ZodType>(
    request: WriteRequest<S>,
    work: (scope: LandingScope) => Built<z.input<S>>,
  ) => z.output<S>;
}

const EDIT_UNSTORABLE = "That edit holds a block the library can't keep.";

const refusalError = (refusal: CellRefusal): Error => {
  switch (refusal.kind) {
    case "gone": {
      return new AccountGoneError();
    }
    case "not-found": {
      return new NotFoundError();
    }
    case "conflict": {
      return new ConflictError({ data: { current: [...refusal.current] } });
    }
    case "url-held": {
      return new ConflictError({
        data: { current: [{ itemId: refusal.itemId, kind: "item", seq: refusal.seq }] },
        message: "Another item in your library already holds this link.",
      });
    }
    case "too-large": {
      return new PayloadTooLargeError();
    }
    case "quota": {
      return new QuotaError({ data: { bytesCap: refusal.bytesCap, bytesUsed: refusal.bytesUsed } });
    }
    case "blob-missing": {
      return new BlobMissingError({ data: { shas: [...refusal.shas] } });
    }
    case "already-undone": {
      return new AlreadyUndoneError({
        data: { changeSetId: refusal.changeSetId, undoneBy: refusal.undoneBy },
      });
    }
    case "edit-refused": {
      return refusal.refusal.reason === "unstorable"
        ? new EditRefusedError({ data: refusal.refusal, message: EDIT_UNSTORABLE })
        : new EditRefusedError({ data: refusal.refusal });
    }
    case "bad-cursor": {
      return new ORPCError("BAD_REQUEST", {
        message: "That cursor isn't one this library answered with.",
      });
    }
    case "agent-unavailable": {
      return new AgentUnavailableError();
    }
    case "agent-budget": {
      return new AgentBudgetError({ data: { resetsAt: refusal.resetsAt } });
    }
    case "turn-ended": {
      return new ORPCError("FORBIDDEN", { message: "This turn has ended." });
    }
    // a write that met a body gone to its note twice over: a fault to send again
    case "note-opened": {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "That item just opened elsewhere. Try again.",
      });
    }
    // no default
  }
};

// a result's value, or its refusal thrown as the error its procedure declares
export const answer = <T>(result: CellResult<T>): T => {
  if (result.ok) {
    return result.value;
  }
  throw refusalError(result.refusal);
};

// a call's context over the cell's engine, its turns and its notes: `actorIn` reads from the rows
// whom its writes are by
export const cellContext = (
  cell: Pick<CellContext, "agent" | "library" | "notes">,
  actorIn: (db: CellDb) => CellActor,
): CellContext => {
  const { library } = cell;
  const actor = (): CellActor => answer(library.read(actorIn));
  return {
    ...cell,
    actor,
    land: (request, work) => {
      const by = actor();
      return answer(library.land(by, request, (scope) => work(scope, by)));
    },
    landApart: (request, work) => answer(library.landApart(request, work)),
    read: (work) => answer(library.read(work)),
    readListing: (work) => answer(library.readListing(work)),
  };
};

// how a list or a read answers unless asked
export const PAGE_DEFAULT = 50;

export const os = implement(libraryTools).$context<CellContext>();
