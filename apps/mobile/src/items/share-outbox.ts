// A share from another app is a waiting save (`@repo/client/waiting-saves`): kept on this phone
// before its first call and sent from there, so one made offline, or one the OS ends the app under,
// waits and lands once the cloud can be reached, and one no resend can land is parked with the
// cloud's words until the person sends it again or lets it go. What is the phone's own is here:
// the list a screen draws, which item a share landed as, for the share inbox to open, and that a
// library left keeps nothing more. Platform-free: its suites run it under node.

import { oneAtATime, waitingSaves } from "@repo/client/waiting-saves";
import type { KvStorage, WaitingSave } from "@repo/client/waiting-saves";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { PhoneSaves } from "./phone-saves";
import { shareSaveSchema } from "./share-payload";
import type { ShareSave } from "./share-payload";

export type WaitingShare = WaitingSave<ShareSave>;

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

const sharesIn = (storage: KvStorage) =>
  waitingSaves({ payload: shareSaveSchema, prefix: "share:", storage });

export const clearStoredShares = async (storage: KvStorage): Promise<void> => {
  await sharesIn(storage).clear();
};

export const createShareOutbox = (args: {
  readonly storage: KvStorage;
  readonly saves: Pick<PhoneSaves, "saveLink" | "saveText" | "stamp">;
  // a share landed: what lists the library reads again
  readonly landed: () => void;
}): ShareOutbox => {
  const shares = sharesIn(args.storage);
  const waiting = createExternalStore<readonly WaitingShare[]>([]);
  shares.onChange(waiting.set);
  // this sign-in's landings, by op id, for the share inbox to open
  const landedIds = new Map<string, string>();
  let closed = false;

  const send = async (share: WaitingShare) => {
    const target = { folderId: null };
    const outcome =
      share.payload.kind === "link"
        ? await args.saves.saveLink(share.payload, target, share)
        : await args.saves.saveText(share.payload.text, target, share);
    if (outcome.kind === "landed") {
      landedIds.set(share.opId, outcome.answer.id);
      args.landed();
    }
    return outcome;
  };

  const flush = oneAtATime(async () => {
    try {
      await shares.pass(send);
    } catch {
      // a store that would not write: what is kept goes again on the next pass, by its op id
    }
  });

  return {
    clear: async () => {
      closed = true;
      await shares.clear();
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
    discard: shares.discard,
    flush,
    keep: async (save) => (closed ? null : await shares.keep(args.saves.stamp(), save)),
    load: async () => {
      waiting.set(await shares.list());
    },
    retry: async (opId) => {
      await shares.retry(opId);
      await flush();
    },
    waiting,
  };
};
