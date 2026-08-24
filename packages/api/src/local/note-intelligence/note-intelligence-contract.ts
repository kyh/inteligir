// Note Intelligence's procedures: read the switch's state, and set it. Neither
// row declares a refusal — the service answers a status for every input the
// schema admits, so the only failure expressible here is input validation's own
// BAD_REQUEST.

import { oc } from "@orpc/contract";
import {
  noteIntelligenceStatusSchema,
  noteIntelligenceToggleSchema,
} from "./note-intelligence-schema";

export const noteIntelligenceContract = {
  status: oc.output(noteIntelligenceStatusSchema),

  toggle: oc.input(noteIntelligenceToggleSchema).output(noteIntelligenceStatusSchema),
};
