// The harness probe's one procedure. It takes no input and refuses nothing:
// an absent CLI or an unreadable credential store is a REPORTED fact, not an
// error, because Settings renders the missing case rather than failing on it.

import { oc } from "@orpc/contract";

import { agentsStatusResponseSchema } from "./agents-schema";

export const agentsContract = {
  status: oc.output(agentsStatusResponseSchema),
};
