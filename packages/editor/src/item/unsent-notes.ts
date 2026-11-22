import { bodyBlockSchema, bodyVersionSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import type { UnsentNote, UnsentNotes } from "@repo/editor/host-io";

const KEY_PREFIX = "inteligir.unsent.";

const unsentSchema = z.object({
  baseBlocks: z.array(bodyBlockSchema),
  baseVersion: bodyVersionSchema,
  blocks: z.array(bodyBlockSchema),
  title: z.string(),
});

const readJson = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return null;
  }
};

const storedUnsentNotes = (storage: () => Storage | null) =>
  ({
    read: (itemId) => {
      try {
        const text = storage()?.getItem(`${KEY_PREFIX}${itemId}`) ?? null;
        const parsed = text === null ? null : unsentSchema.safeParse(readJson(text));

        return parsed?.success === true ? (parsed.data satisfies UnsentNote) : null;
      } catch {
        return null;
      }
    },
    write: (itemId, note) => {
      try {
        const key = `${KEY_PREFIX}${itemId}`;

        if (note === null) {
          storage()?.removeItem(key);
        } else {
          storage()?.setItem(key, JSON.stringify(note));
        }

        return true;
      } catch {
        return false;
      }
    },
  }) satisfies UnsentNotes;

export const pageUnsentNotes = () =>
  storedUnsentNotes(() => (typeof localStorage === "undefined" ? null : localStorage));

export const forgetUnsentNotes = (storage: Storage | null) => {
  try {
    const keys = Array.from({ length: storage?.length ?? 0 }, (_, at) => storage?.key(at)).filter(
      (key): key is string => key?.startsWith(KEY_PREFIX) === true,
    );

    for (const key of keys) {
      storage?.removeItem(key);
    }

    return true;
  } catch {
    return false;
  }
};
