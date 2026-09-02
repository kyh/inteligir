import { ORPCError } from "@orpc/server";

import { base, refusals } from "../orpc";
import { vaultWireError } from "../vault/vault-refusals";
import { VaultServiceError } from "../vault/vault-service";
import { CommentRefusedError, SidecarConflictError, SidecarInvalidError } from "./comments-service";

// the vault's refusals are translated by vault-refusals.ts, not restated here: two
// translations of one class drift (a sidecar conflict at 500 beside vault.write's 409).
function asWireError(cause: unknown) {
  if (cause instanceof SidecarInvalidError || cause instanceof SidecarConflictError) {
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
    // a missing note cannot reach here (list folds with unknown markers), and the row declares no NOT_FOUND.
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
