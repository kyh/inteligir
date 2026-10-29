import { oc } from "@orpc/contract";
import { IMPORT_UNREADABLE } from "../local-errors";
import {
  importsCancelRequestSchema,
  importsJobResponseSchema,
  importsPlanRequestSchema,
  importsPlanResponseSchema,
  importsStartRequestSchema,
  importsStatusResponseSchema,
} from "./imports-schema";

export const importsContract = {
  // NOT_FOUND: no job has that id
  cancel: oc
    .input(importsCancelRequestSchema)
    .output(importsJobResponseSchema)
    .errors({ NOT_FOUND: {} }),

  plan: oc
    .input(importsPlanRequestSchema)
    .output(importsPlanResponseSchema)
    .errors({ IMPORT_UNREADABLE }),

  // NOT_FOUND: the plan expired (24 h) or was used. CONFLICT: a job is running. FORBIDDEN: a
  // start from an agent's shell, which the turn's Undo could not take back
  start: oc
    .input(importsStartRequestSchema)
    .output(importsJobResponseSchema)
    .errors({ CONFLICT: {}, FORBIDDEN: {}, NOT_FOUND: {} }),

  status: oc.output(importsStatusResponseSchema),
};
