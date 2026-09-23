import { oc } from "@orpc/contract";
import {
  browserHandoffResponseSchema,
  guideResponseSchema,
  systemStatusResponseSchema,
} from "./system-schema";

export const systemContract = {
  /** A single-use nonce a browser trades for its session cookie through `browserHandoffUrl`,
   *  valid for minutes: a browser cannot carry the bearer, so this is how one signs in. */
  browserHandoff: oc.output(browserHandoffResponseSchema),
  /** The agent manual, served by the app so a model always fetches the one
   *  that matches the running build. */
  guide: oc.output(guideResponseSchema),
  status: oc.output(systemStatusResponseSchema),
};
