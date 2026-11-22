import type { KvStorage } from "@repo/client/waiting-saves";
import { parseUnsentNote } from "@repo/contract/library/unsent-note";
import type { UnsentNote } from "@repo/contract/library/unsent-note";

const PREFIX = "unsent:";

export interface UnsentStore {
  readonly read: (itemId: string) => Promise<UnsentNote | null>;
  readonly write: (itemId: string, note: UnsentNote | null) => Promise<void>;
  readonly clear: () => Promise<void>;
}

export const createUnsentStore = (storage: KvStorage) =>
  ({
    clear: async () => {
      const held = await storage.getAllKeys();
      const keys = held.filter((key) => key.startsWith(PREFIX));
      await Promise.all(
        keys.map(async (key) => {
          await storage.removeItem(key);
        }),
      );
    },
    read: async (itemId) => {
      const text = await storage.getItem(`${PREFIX}${itemId}`);

      return text === null ? null : parseUnsentNote(text);
    },
    write: async (itemId, note) => {
      await (note === null
        ? storage.removeItem(`${PREFIX}${itemId}`)
        : storage.setItem(`${PREFIX}${itemId}`, JSON.stringify(note)));
    },
  }) satisfies UnsentStore;
