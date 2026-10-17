import type { ANNOTATIONS_REFUSAL_ERRORS } from "@repo/contract/local/errors";
import { ORPCError } from "@orpc/server";

import { attributeWrites, base, refusing } from "../orpc";
import type { AppContext } from "../orpc";
import { vaultWireError } from "../vault/vault-refusals";
import { AnnotationsError } from "./annotations-service";
import type { AnnotationsErrorCode, AnnotationsWrite } from "./annotations-service";

const ANNOTATIONS_REFUSALS = {
  conflict: "CONFLICT",
  invalid: "CONFLICT",
  "passage-not-found": "BAD_REQUEST",
  refused: "BAD_REQUEST",
} as const satisfies Record<AnnotationsErrorCode, keyof typeof ANNOTATIONS_REFUSAL_ERRORS>;

// vault refusals are translated by vault-refusals.ts, not restated here.
const asWireError = (cause: unknown): ORPCError<string, unknown> | null =>
  cause instanceof AnnotationsError
    ? new ORPCError(ANNOTATIONS_REFUSALS[cause.code], { message: cause.message })
    : vaultWireError(cause);

const annotationsRefusals = refusing(asWireError);

const attributed = <T>(context: AppContext, written: AnnotationsWrite<T>): T => {
  attributeWrites(context, written.wrote);
  return written.answer;
};

const list = base.annotations.list
  .use(annotationsRefusals)
  .handler(async ({ context, input }) => await context.annotations.list(input.path));

const add = base.annotations.add
  .use(annotationsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.annotations.add(input)));

const reply = base.annotations.reply
  .use(annotationsRefusals)
  .handler(async ({ context, input }) =>
    attributed(context, await context.annotations.reply(input)),
  );

const edit = base.annotations.edit
  .use(annotationsRefusals)
  .handler(async ({ context, input }) =>
    attributed(context, await context.annotations.edit(input)),
  );

const remove = base.annotations.remove
  .use(annotationsRefusals)
  .handler(async ({ context, input }) =>
    attributed(context, await context.annotations.remove(input)),
  );

export const annotationsRouter = {
  add,
  edit,
  list,
  remove,
  reply,
};
