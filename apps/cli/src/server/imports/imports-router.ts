// ImportsError is translated through one total table; an unreadable file carries its reason as
// the wire error's data.

import { ORPCError } from "@orpc/server";

import { base, refusing } from "../orpc";
import { ImportsError } from "./imports-error";
import type { ImportsErrorCode } from "./imports-error";

const IMPORTS_REFUSALS = {
  "agent-started": "FORBIDDEN",
  "job-not-found": "NOT_FOUND",
  "plan-gone": "NOT_FOUND",
  running: "CONFLICT",
  unreadable: "IMPORT_UNREADABLE",
} as const satisfies Record<
  ImportsErrorCode,
  "CONFLICT" | "FORBIDDEN" | "IMPORT_UNREADABLE" | "NOT_FOUND"
>;

const asWireError = (cause: unknown): ORPCError<string, unknown> | null => {
  if (!(cause instanceof ImportsError)) {
    return null;
  }
  const code = IMPORTS_REFUSALS[cause.code];
  return cause.reason === null
    ? new ORPCError(code, { message: cause.message })
    : new ORPCError(code, { data: { reason: cause.reason }, message: cause.message });
};

const importsRefusals = refusing(asWireError);

const plan = base.imports.plan.use(importsRefusals).handler(async ({ context, input }) => {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  return await context.imports.plan(input.source, bytes);
});

// an agent's shell may plan an import but not start one: the job commits its batches as the
// engine long after the turn ends, so the turn's Undo changes could take none of them back
const start = base.imports.start.use(importsRefusals).handler(async ({ context, input }) => {
  if (context.agentThreadId !== null) {
    throw new ImportsError("agent-started");
  }
  return { job: await context.imports.start(input.planId) };
});

const status = base.imports.status.handler(async ({ context }) => ({
  job: await context.imports.status(),
}));

const cancel = base.imports.cancel
  .use(importsRefusals)
  .handler(async ({ context, input }) => ({ job: await context.imports.cancel(input.id) }));

export const importsRouter = {
  cancel,
  plan,
  start,
  status,
};
