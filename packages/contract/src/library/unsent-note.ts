import { z } from "zod";

import type { BodyBlock } from "./derive-item";
import { bodyBlockSchema, bodyVersionSchema } from "./library-wire";

const unsentNoteSchema = z.object({
  baseBlocks: z.array(bodyBlockSchema),
  baseVersion: bodyVersionSchema,
  blocks: z.array(bodyBlockSchema),
  title: z.string(),
});

export interface UnsentNote {
  readonly baseVersion: number;
  readonly baseBlocks: readonly BodyBlock[];
  readonly blocks: readonly BodyBlock[];
  readonly title: string;
}

const readJson = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return null;
  }
};

export const parseUnsentNote = (text: string) => {
  const parsed = unsentNoteSchema.safeParse(readJson(text));

  return parsed.success ? (parsed.data satisfies UnsentNote) : null;
};
