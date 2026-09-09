import { oc } from "@orpc/contract";

import { agentsSetDefaultRequestSchema, agentsStatusResponseSchema } from "./agents-schema";

export const agentsContract = {
  // NOT_FOUND: no harness by that id; the probe list is the set of ids
  setDefault: oc
    .input(agentsSetDefaultRequestSchema)
    .output(agentsStatusResponseSchema)
    .errors({ NOT_FOUND: {} }),
  status: oc.output(agentsStatusResponseSchema),
};
