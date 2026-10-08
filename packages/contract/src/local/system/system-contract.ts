import { oc } from "@orpc/contract";
import { browserHandoffResponseSchema, systemStatusResponseSchema } from "./system-schema";

export const systemContract = {
  /** A single-use nonce a browser trades for its session cookie through `browserHandoffUrl`,
   *  valid for minutes: a browser cannot carry the bearer, so this is how one signs in.
   *  NOT_FOUND: this server serves no UI (an unbuilt checkout), so the link would 404. */
  browserHandoff: oc.output(browserHandoffResponseSchema).errors({ NOT_FOUND: {} }),
  status: oc.output(systemStatusResponseSchema),
};
