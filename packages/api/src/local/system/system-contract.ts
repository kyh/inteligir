import { oc } from "@orpc/contract";
import { guideResponseSchema, systemStatusResponseSchema } from "./system-schema";

export const systemContract = {
  /** The agent manual, served by the app so a model always fetches the one
   *  that matches the running build. */
  guide: oc.output(guideResponseSchema),
  status: oc.output(systemStatusResponseSchema),
};
