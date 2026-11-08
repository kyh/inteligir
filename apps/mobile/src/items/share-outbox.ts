// A share from another app, kept on this phone before its first call and sent from there, so one
// made offline, or one the OS ends the app under, waits and lands once the cloud can be reached.
// Each is one key of the phone's store, holding the share as it came and the ids minted for it, so
// a resend after a lost answer lands once. A pass sends the oldest first, one pass at a time: one
// that lands goes, one the cloud cannot answer now stops the pass for the next, and one no resend
// can land is parked with the cloud's words until the person sends it again or lets it go. Leaving
// the account clears every one. Platform-free: the suites and the scenario suite run it under node.

import { z } from "zod";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { serialLock } from "../lib/serial-lock";
import type { PhoneSaves } from "./phone-saves";
import type { SharedSave } from "./share-payload";

// the phone's key-value store, as expo-sqlite's kv-store and the persisted cache read it
export interface KvStorage {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
  readonly getAllKeys: () => Promise<readonly string[]>;
}

const KEY_PREFIX = "share:";

const keyOf = (opId: string): string => `${KEY_PREFIX}${opId}`;

const waitingShareSchema = z.object({
  id: z.string().min(1),
  opId: z.string().min(1),
  // why the cloud took it as no resend would land it; null while it waits to be sent
  refused: z.string().nullable(),
  save: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("link"),
      note: z.string().nullable(),
      title: z.string().nullable(),
      url: z.string(),
    }),
    z.object({ kind: z.literal("text"), text: z.string() }),
  ]),
  savedAt: z.number(),
});

export type WaitingShare = z.infer<typeof waitingShareSchema>;

type ShareSave = Exclude<SharedSave, { kind: "nothing" }>;

type ShareOutcome =
  | { readonly kind: "landed"; readonly itemId: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "refused"; readonly message: string };

export interface ShareOutbox {
  // oldest first, the parked among them
  readonly waiting: ReadableStore<readonly WaitingShare[]>;
  // what the store held when the app last ran
  readonly load: () => Promise<void>;
  // kept before anything is sent; null once the account was left
  readonly keep: (save: ShareSave) => Promise<WaitingShare | null>;
  // a pass over every one waiting; it never throws
  readonly flush: () => Promise<void>;
  // a pass, then what became of one share
  readonly deliver: (opId: string) => Promise<ShareOutcome>;
  readonly retry: (opId: string) => Promise<void>;
  readonly discard: (opId: string) => Promise<void>;
  // every one goes, and nothing is kept after
  readonly clear: () => Promise<void>;
}

const oldestFirst = (a: WaitingShare, b: WaitingShare): number =>
  a.savedAt - b.savedAt || (a.opId < b.opId ? -1 : 1);

const shareJsonSchema = z.string().transform((text, context) => {
  try {
    return waitingShareSchema.parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not a share this build reads" });
    return z.NEVER;
  }
});

// every share the store holds; one this build cannot read is no share
const storedShares = async (storage: KvStorage): Promise<WaitingShare[]> => {
  const shares: WaitingShare[] = [];
  for (const key of await storage.getAllKeys()) {
    if (!key.startsWith(KEY_PREFIX)) {
      continue;
    }
    const share = shareJsonSchema.safeParse(await storage.getItem(key));
    if (share.success) {
      shares.push(share.data);
    } else {
      await storage.removeItem(key);
    }
  }
  return shares.toSorted(oldestFirst);
};

export const clearStoredShares = async (storage: KvStorage): Promise<void> => {
  for (const key of await storage.getAllKeys()) {
    if (key.startsWith(KEY_PREFIX)) {
      await storage.removeItem(key);
    }
  }
};

export const createShareOutbox = (args: {
  readonly storage: KvStorage;
  readonly saves: Pick<PhoneSaves, "saveLink" | "saveText" | "stamp">;
  // a share landed: what lists the library reads again
  readonly landed: () => void;
}): ShareOutbox => {
  const { storage } = args;
  const waiting = createExternalStore<readonly WaitingShare[]>([]);
  const lock = serialLock();
  // this sign-in's landings, by op id, for the share inbox to open
  const landedIds = new Map<string, string>();
  let closed = false;

  const replace = (share: WaitingShare): void => {
    waiting.set(
      [...waiting.get().filter((held) => held.opId !== share.opId), share].toSorted(oldestFirst),
    );
  };

  const drop = (opId: string): void => {
    waiting.set(waiting.get().filter((held) => held.opId !== opId));
  };

  const write = async (share: WaitingShare): Promise<void> => {
    await storage.setItem(keyOf(share.opId), JSON.stringify(share));
  };

  const send = async (share: WaitingShare) => {
    const target = { folderId: null };
    const stamp = { id: share.id, opId: share.opId, savedAt: share.savedAt };
    return share.save.kind === "link"
      ? await args.saves.saveLink(share.save, target, stamp)
      : await args.saves.saveText(share.save.text, target, stamp);
  };

  const pass = async (): Promise<void> => {
    for (const share of waiting.get()) {
      if (closed) {
        return;
      }
      const current = waiting.get().find((held) => held.opId === share.opId);
      if (current === undefined || current.refused !== null) {
        continue;
      }
      const outcome = await send(current);
      if (closed) {
        return;
      }
      switch (outcome.kind) {
        case "saved": {
          await storage.removeItem(keyOf(current.opId));
          landedIds.set(current.opId, outcome.id);
          drop(current.opId);
          args.landed();
          break;
        }
        case "refused": {
          const parked = { ...current, refused: outcome.message };
          await write(parked);
          replace(parked);
          break;
        }
        case "unreachable":
        case "ended": {
          return;
        }
        // no default
      }
    }
  };

  const flush = async (): Promise<void> => {
    await lock(async () => {
      try {
        await pass();
      } catch {
        // a store that would not write: what is kept goes again on the next pass, by its op id
      }
    });
  };

  return {
    clear: async () => {
      closed = true;
      waiting.set([]);
      await clearStoredShares(storage);
    },
    deliver: async (opId) => {
      await flush();
      const itemId = landedIds.get(opId);
      if (itemId !== undefined) {
        return { itemId, kind: "landed" };
      }
      const refused = waiting.get().find((share) => share.opId === opId)?.refused ?? null;
      return refused === null ? { kind: "waiting" } : { kind: "refused", message: refused };
    },
    discard: async (opId) => {
      await storage.removeItem(keyOf(opId));
      drop(opId);
    },
    flush,
    keep: async (save) => {
      if (closed) {
        return null;
      }
      const { id, opId, savedAt } = args.saves.stamp();
      const share: WaitingShare = { id, opId, refused: null, save, savedAt };
      await write(share);
      replace(share);
      return share;
    },
    load: async () => {
      const shares = await storedShares(storage);
      if (!closed) {
        waiting.set(shares);
      }
    },
    retry: async (opId) => {
      const held = waiting.get().find((share) => share.opId === opId);
      if (held !== undefined) {
        const again = { ...held, refused: null };
        await write(again);
        replace(again);
      }
      await flush();
    },
    waiting,
  };
};
