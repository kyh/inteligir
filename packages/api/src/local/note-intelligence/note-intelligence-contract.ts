import { oc } from "@orpc/contract";
import {
  noteIntelligenceStatusSchema,
  noteIntelligenceToggleSchema,
} from "./note-intelligence-schema";

export const noteIntelligenceContract = {
  status: oc.output(noteIntelligenceStatusSchema),

  toggle: oc.input(noteIntelligenceToggleSchema).output(noteIntelligenceStatusSchema),
};
