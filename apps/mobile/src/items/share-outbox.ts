import { oneAtATime, waitingSaves } from "@repo/client/waiting-saves";
import type { KvStorage, WaitingSave } from "@repo/client/waiting-saves";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import type { PhoneSaves } from "./phone-saves";
import { shareSaveSchema } from "./share-payload";
import type { ShareSave } from "./share-payload";

export type WaitingShare = WaitingSave<ShareSave>;

export interface ShareOutbox {
  readonly waiting: ReadableStore<readonly WaitingShare[]>;
  readonly load: () => Promise<void>;
  readonly keep: (save: ShareSave) => Promise<WaitingShare | null>;
  readonly flush: () => Promise<void>;
  readonly deliver: (opId: string) => Promise<string | null>;
  readonly retry: (opId: string) => Promise<void>;
  readonly discard: (opId: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

const sameShare = (a: ShareSave, b: ShareSave) =>
  a.kind === "link" && b.kind === "link" && a.url === b.url && a.note === b.note;

const sharesIn = (storage: KvStorage) =>
  waitingSaves({ payload: shareSaveSchema, prefix: "share:", sameSave: sameShare, storage });

export const clearStoredShares = async (storage: KvStorage) => {
  await sharesIn(storage).clear();
};

export const createShareOutbox = (args: {
  readonly storage: KvStorage;
  readonly saves: Pick<PhoneSaves, "saveLink" | "saveText" | "stamp">;
  readonly landed: () => void;
}) => {
  const shares = sharesIn(args.storage);
  const waiting = createExternalStore<readonly WaitingShare[]>([]);
  shares.onChange(waiting.set);
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
    await Promise.allSettled([shares.pass(send)]);
  });

  return {
    clear: async () => {
      closed = true;
      await shares.clear();
    },
    deliver: async (opId) => {
      await flush();

      return landedIds.get(opId) ?? null;
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
  } satisfies ShareOutbox;
};
