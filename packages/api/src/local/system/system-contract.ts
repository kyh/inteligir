import { oc } from "@orpc/contract";
import { guideResponseSchema, systemStatusResponseSchema } from "./system-schema";

export const systemContract = {
  status: oc.output(systemStatusResponseSchema),
  /** The agent manual, served by the app so a model always fetches the one
   *  that matches the running build. */
  guide: oc.output(guideResponseSchema),
};
