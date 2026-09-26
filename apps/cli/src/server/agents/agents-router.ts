// each harness's runtime and its vendor's sign-in, for Settings and `agents list`. It refuses
// nothing: a missing runtime or a vendor that did not answer is a REPORTED fact.

import { ORPCError } from "@orpc/server";
import { base, refusals } from "../orpc";
import { UnknownHarnessError } from "./agents-service";

const refusingUnknown = refusals((cause) =>
  cause instanceof UnknownHarnessError
    ? new ORPCError("NOT_FOUND", { message: cause.message })
    : null,
);

const status = base.agents.status.handler(async ({ context }) => await context.agents.status());

const setDefault = base.agents.setDefault.handler(
  async ({ context, input }) =>
    await refusingUnknown(async () => await context.agents.setDefault(input.id)),
);

export const agentsRouter = {
  setDefault,
  status,
};
