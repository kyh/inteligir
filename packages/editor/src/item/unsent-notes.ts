import { parseUnsentNote } from "@repo/contract/library/unsent-note";

import type { UnsentNotes } from "@repo/editor/host-io";

const KEY_PREFIX = "inteligir.unsent.";

const storedUnsentNotes = (storage: () => Storage | null) =>
  ({
    read: (itemId) => {
      try {
        const text = storage()?.getItem(`${KEY_PREFIX}${itemId}`) ?? null;

        return text === null ? null : parseUnsentNote(text);
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
