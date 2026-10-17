// a named action rides the send as a preset, never as a prompt in the text: the server composes
// its block, the stored text stays what was typed (or the label, when nothing was), and it survives
// the queue in its own column. it is no part of any thread event, so no other device reads it.

import { z } from "zod";

export const actionPresetSchema = z.enum(["tidy-library"]);
export type ActionPreset = z.infer<typeof actionPresetSchema>;

export const ACTION_PRESET_LABELS = {
  "tidy-library": "Tidy my library",
} satisfies Record<ActionPreset, string>;
