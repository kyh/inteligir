// The comments handlers. The editor is the caller and owns the body markers;
// these procedures own the sidecar (the division the inteligir-comments skill
// states), so every answer is the fresh folded listing and `remove` also names
// the ids whose markers the editor must strip.
//
// ONE TRANSLATION, not one per handler. Every refusal these procedures can
// raise is a `SidecarInvalidError`, a `CommentRefusedError`, or one the VAULT
// raised — the sidecar is a file in it — and the vault's half is deferred to
// `vault-refusals.ts` rather than restated here. Restating it is what made a
// sidecar `conflict` answer 500 while `vault.write` answered 409 for the same
// error. WHICH classes a given procedure can raise is still declared per row —
// in the contract, where the client reads it.

import { ORPCError } from "@orpc/server";

import { base, refusals } from "../orpc";
import { vaultWireError } from "../vault/vault-refusals";
import { VaultServiceError } from "../vault/vault-service";
import { CommentRefusedError, SidecarInvalidError } from "./comments-service";

/** A comments refusal as the wire class, or null for anything neither this
 *  layer nor the vault has a name for — which is a 500, and should be. */
function asWireError(cause: unknown) {
  if (cause instanceof SidecarInvalidError) {
    return new ORPCError("CONFLICT", { message: cause.message });
  }
  if (cause instanceof CommentRefusedError) {
    return new ORPCError("BAD_REQUEST", { message: cause.message });
  }
  return vaultWireError(cause);
}

const refusing = refusals(asWireError);

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
