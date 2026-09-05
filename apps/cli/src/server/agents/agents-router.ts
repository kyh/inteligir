// The harness probe for Settings' detect+guide surface. It refuses nothing:
// an absent CLI or an unreadable credential store is a REPORTED fact.

import { ORPCError } from "@orpc/server";
import { base, refusals } from "../orpc";
import { UnknownHarnessError } from "./agents-service";

const refusingUnknown = refusals((cause) =>
  cause instanceof UnknownHarnessError
    ? new ORPCError("NOT_FOUND", { message: cause.message })
    : null,
);

const status = base.agents.status.handler(({ context }) => context.agents.status());

const setDefault = base.agents.setDefault.handler(({ context, input }) =>
  refusingUnknown(() => context.agents.setDefault(input.id)),
);

export const agentsRouter = {
  status,
  setDefault,
};
