// The comments handlers. The editor is the caller and owns the body markers;
// these procedures own the sidecar (the division the inteligir-comments skill
// states), so every answer is the fresh folded listing and `remove` also names
// the ids whose markers the editor must strip.
//
// ONE TRANSLATION, not one per handler. Every refusal these procedures can
// raise is a `SidecarInvalidError`, a `CommentRefusedError`, or the vault's own
// `VaultServiceError`/`VaultPathError`, and `asWireError` below is the single
// place "what does the wire call this?" is answered. WHICH classes a given
// procedure can raise is still declared per row — in the contract, where the
// client reads it.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { ORPCError } from "@orpc/server";

import { base } from "../orpc";
import { VaultServiceError } from "../vault/vault-service";
import { CommentRefusedError, SidecarInvalidError } from "./comments-service";

/** A comments refusal as the wire class, or null for anything this layer has
 *  no name for — which is a 500, and should be. A `VaultServiceError` that is
 *  not `not_found` falls through deliberately: no row here declares a class
 *  for one. */
function asWireError(cause: unknown) {
  if (cause instanceof SidecarInvalidError) {
    return new ORPCError("CONFLICT", { message: cause.message });
  }
  if (cause instanceof CommentRefusedError) {
    return new ORPCError("BAD_REQUEST", { message: cause.message });
  }
  if (cause instanceof VaultServiceError && cause.code === "not_found") {
    return new ORPCError("NOT_FOUND", { message: cause.message });
  }
  if (cause instanceof VaultPathError) {
    return new ORPCError("INVALID_PATH", { message: cause.message });
  }
  return null;
}

/** Runs `work`, re-raising a domain refusal as the class the contract declares. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw asWireError(cause) ?? cause;
  }
}

const list = base.comments.list.handler(async ({ context, input }) => {
  try {
    return await context.comments.list(input.path);
  } catch (cause) {
    // A list against a missing note still answers its sidecar (a thread can
    // outlive its note through an external delete): the service folds with
    // unknown markers rather than refusing, so a missing note cannot reach
    // here — and this row declares no NOT_FOUND to answer it with.
    if (cause instanceof VaultServiceError && cause.code === "not_found") throw cause;
    throw asWireError(cause) ?? cause;
  }
});

const add = base.comments.add.handler(({ context, input }) =>
  refusing(() => context.comments.add(input)),
);

const reply = base.comments.reply.handler(({ context, input }) =>
  refusing(() => context.comments.reply(input)),
);

const resolve = base.comments.resolve.handler(({ context, input }) =>
  refusing(() => context.comments.resolve(input)),
);

const remove = base.comments.remove.handler(({ context, input }) =>
  refusing(() => context.comments.remove(input)),
);

export const commentsRouter = {
  list,
  add,
  reply,
  resolve,
  remove,
};
