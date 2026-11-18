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

export interface LibraryContext {
  readonly principal: LibraryPrincipal;
  readonly kickJobs?: JobKick;
}

type EditRefusal = Extract<LibraryRefusal, { kind: "edit-refused" }>["refusal"];

type MarkdownFault = Extract<LibraryRefusal, { kind: "markdown-refused" }>["fault"];

const MARKDOWN_REFUSED: Record<MarkdownFault, string> = {
  "too-deep":
    "That new text nests deeper than an item holds. Nest its lists and quotes fewer levels deep.",
  unstorable:
    "That new text holds a block the library can't keep. Split that part up or write it more plainly.",
};

const EDIT_REFUSED: Record<EditRefusal["kind"], string> = {
  ambiguous:
    "That old text stands more than once in the note. Quote more of the passage, so it stands once.",
  missing:
    "That old text isn't in the item's note. Read the item again and quote the passage exactly.",
  section:
    "That passage is in the article, the page as it was read, which no edit changes. Write in the note: an empty old text adds its new text after the note.",
  ...MARKDOWN_REFUSED,
};

const refusalError = (refusal: LibraryRefusal) => {
  switch (refusal.kind) {
    case "not-found": {
      return new NotFoundError() satisfies Error;
    }

    case "conflict": {
      return new ConflictError() satisfies Error;
    }

    case "url-held": {
      return new ConflictError({
        message: "Another item in your library already holds this link.",
      }) satisfies Error;
    }

    case "too-large": {
      return new PayloadTooLargeError() satisfies Error;
    }

    case "quota": {
      return new QuotaError({
        data: { bytesCap: refusal.bytesCap, bytesUsed: refusal.bytesUsed },
      }) satisfies Error;
    }

    case "blob-missing": {
      return new BlobMissingError({ data: { shas: [...refusal.shas] } }) satisfies Error;
    }

    case "blob-mismatch": {
      return new BlobMismatchError() satisfies Error;
    }

    case "blob-too-large": {
      return new PayloadTooLargeError({
        message: "This file is larger than your library keeps.",
      }) satisfies Error;
    }

    case "gone": {
      return new AccountGoneError() satisfies Error;
    }

    case "markdown-refused": {
      return new PayloadTooLargeError({ message: MARKDOWN_REFUSED[refusal.fault] }) satisfies Error;
    }

    case "edit-refused": {
      return new EditRefusedError({
        data: refusal.refusal,
        message: EDIT_REFUSED[refusal.refusal.kind],
      }) satisfies Error;
    }

    case "turn-ended": {
      return new ORPCError("FORBIDDEN", { message: "This turn has ended." }) satisfies Error;
    }

    case "busy": {
      return new TooManyRequestsError({
        data: { retryAfterSeconds: 1 },
        message: "Your library is busy with another change. Try again.",
      }) satisfies Error;
    }

    default: {
      throw new Error(`unexpected ${String(refusal satisfies never)}`);
    }
  }
};

export const answer = <T>(result: LibraryResult<T>) => {
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

const library = implement(libraryTools).$context<LibraryContext>();

export const reading = library.use(requireLibrary("read"));
export const writing = library.use(requireLibrary("write"));
