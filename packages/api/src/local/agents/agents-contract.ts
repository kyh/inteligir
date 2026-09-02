import { oc } from "@orpc/contract";

import { agentsStatusResponseSchema } from "./agents-schema";

export const agentsContract = {
  status: oc.output(agentsStatusResponseSchema),
};
