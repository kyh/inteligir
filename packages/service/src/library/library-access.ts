// A library call's access, and the one place each refusal becomes the error its row declares
// (`@repo/contract/rpc/v1-errors`). Every row is built on `reading` or `writing`, whose middleware
// runs before the row reads its input: it resolves the caller from the principal its door verified,
// and refuses a write to a grant that only reads. A refusal is thrown inside a write, caught at its
// transaction's edge as a value (`./library-store`) and thrown again here.

import {
  AccountGoneError,
  BlobMismatchError,
  BlobMissingError,
  ConflictError,
  EditRefusedError,
  NotFoundError,
  PayloadTooLargeError,
  QuotaError,
  TooManyRequestsError,
} from "@repo/contract/rpc/v1-errors";
import { implement, ORPCError, os } from "@orpc/server";

import { changesLibrary, libraryActorOf } from "./library-principal";
import type { LibraryPrincipal } from "./library-principal";
import type { LibraryRefusal, LibraryResult } from "./library-refusal";
import type { JobKick, LibraryWriter } from "./library-store";
import { libraryTools } from "./library-tools";

// what every door hands the library: `/v1`'s session, the connector's grant, the agent's turn; and,
// from a door that serves a request, the kick a write's jobs get after its response
export interface LibraryContext {
  readonly principal: LibraryPrincipal;
  readonly kickJobs?: JobKick;
}

type EditRefusal = Extract<LibraryRefusal, { kind: "edit-refused" }>["refusal"];
type MarkdownFault = Extract<LibraryRefusal, { kind: "markdown-refused" }>["fault"];

// what the writer of markdown no body can hold changes, a new note's or an edit's new text, said in
// the message, since an agent is handed a refusal's message alone
const MARKDOWN_REFUSED: Record<MarkdownFault, string> = {
  "too-deep":
    "That new text nests deeper than an item holds. Nest its lists and quotes fewer levels deep.",
  unstorable:
    "That new text holds a block the library can't keep. Split that part up or write it more plainly.",
};

// what a refused edit's writer does next
const EDIT_REFUSED: Record<EditRefusal["kind"], string> = {
  ambiguous:
    "That old text stands more than once in the note. Quote more of the passage, so it stands once.",
  missing:
    "That old text isn't in the item's note. Read the item again and quote the passage exactly.",
  section:
    "That passage is in the article, the page as it was read, which no edit changes. Write in the note: an empty old text adds its new text after the note.",
  ...MARKDOWN_REFUSED,
};

const refusalError = (refusal: LibraryRefusal): Error => {
  switch (refusal.kind) {
    case "not-found": {
      return new NotFoundError();
    }
    case "conflict": {
      return new ConflictError();
    }
    case "url-held": {
      return new ConflictError({
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
    case "blob-mismatch": {
      return new BlobMismatchError();
    }
    case "blob-too-large": {
      return new PayloadTooLargeError({ message: "This file is larger than your library keeps." });
    }
    case "gone": {
      return new AccountGoneError();
    }
    // every row that takes markdown declares this code, so only its message changes with the fault
    case "markdown-refused": {
      return new PayloadTooLargeError({ message: MARKDOWN_REFUSED[refusal.fault] });
    }
    case "edit-refused": {
      return new EditRefusedError({
        data: refusal.refusal,
        message: EDIT_REFUSED[refusal.refusal.kind],
      });
    }
    case "turn-ended": {
      return new ORPCError("FORBIDDEN", { message: "This turn has ended." });
    }
    // every row declares it, and a client's link waits out the second it names as it does the
    // request budget, past the write ahead of it
    case "busy": {
      return new TooManyRequestsError({
        data: { retryAfterSeconds: 1 },
        message: "Your library is busy with another change. Try again.",
      });
    }
    // no default
  }
};

// a result's value, or its refusal thrown as the error its row declares
export const answer = <T>(result: LibraryResult<T>): T => {
  if (result.ok) {
    return result.value;
  }
  throw refusalError(result.refusal);
};

const requireLibrary = (needs: "read" | "write") =>
  os.$context<LibraryContext>().middleware(async ({ context, next }) => {
    const { principal } = context;
    if (needs === "write" && !changesLibrary(principal)) {
      throw new ORPCError("FORBIDDEN", {
        message: "This connection reads your library and changes nothing in it.",
      });
    }
    const library: LibraryWriter = {
      accountId: principal.accountId,
      actor: libraryActorOf(principal),
      kickJobs: context.kickJobs,
    };
    return await next({ context: { library } });
  });

// the tagged contract, so each routed row carries its tool for whoever lists the tools
const library = implement(libraryTools).$context<LibraryContext>();

// on the implementer, so a caller refused learns nothing of the input
export const reading = library.use(requireLibrary("read"));
export const writing = library.use(requireLibrary("write"));
