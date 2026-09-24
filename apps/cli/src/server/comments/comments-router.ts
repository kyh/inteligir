import { ORPCError } from "@orpc/server";

import { attributeWrites, base, refusals } from "../orpc";
import type { AppContext } from "../orpc";
import { vaultWireError } from "../vault/vault-refusals";
import { CommentRefusedError } from "./comment-refused-error";
import type { CommentsWrite } from "./comments-service";
import { SidecarConflictError } from "./sidecar-conflict-error";
import { SidecarInvalidError } from "./sidecar-invalid-error";

// the vault's refusals are translated by vault-refusals.ts, not restated here: two
// translations of one class drift (a sidecar conflict at 500 beside vault.write's 409).
const asWireError = (cause: unknown) => {
  if (cause instanceof SidecarInvalidError || cause instanceof SidecarConflictError) {
    return new ORPCError("CONFLICT", { message: cause.message });
  }
  if (cause instanceof CommentRefusedError) {
    return new ORPCError("BAD_REQUEST", { message: cause.message });
  }
  return vaultWireError(cause);
};

const refusing = refusals(asWireError);

const attributed = <T>(context: AppContext, written: CommentsWrite<T>): T => {
  attributeWrites(context, written.wrote);
  return written.answer;
};

const list = base.comments.list.handler(
  async ({ context, input }) =>
    await refusing(async () => attributed(context, await context.comments.list(input.path))),
);

const add = base.comments.add.handler(
  async ({ context, input }) =>
    await refusing(async () => attributed(context, await context.comments.add(input))),
);

const reply = base.comments.reply.handler(
  async ({ context, input }) =>
    await refusing(async () => attributed(context, await context.comments.reply(input))),
);

const resolve = base.comments.resolve.handler(
  async ({ context, input }) =>
    await refusing(async () => attributed(context, await context.comments.resolve(input))),
);

const remove = base.comments.remove.handler(
  async ({ context, input }) =>
    await refusing(async () => attributed(context, await context.comments.remove(input))),
);

export const commentsRouter = {
  add,
  list,
  remove,
  reply,
  resolve,
};
