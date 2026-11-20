import type { CallOutcome } from "@repo/contract/rpc/call-outcome";
import { z } from "zod";

import { serialLock } from "./serial-lock";

export interface KvStorage {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
  readonly getAllKeys: () => Promise<readonly string[]>;
}

export interface SaveStamp {
  readonly id: string;
  readonly opId: string;
  readonly savedAt: number;
}

export interface WaitingSave<P> extends SaveStamp {
  readonly refused: string | null;
  readonly payload: P;
}

type Sent = CallOutcome<unknown> | { readonly kind: "skipped" };

interface WaitingSaves<P> {
  readonly list: () => Promise<readonly WaitingSave<P>[]>;
  readonly keep: (stamp: SaveStamp, payload: P) => Promise<WaitingSave<P>>;
  readonly settle: (opId: string, outcome: CallOutcome<unknown>) => Promise<void>;
  readonly pass: (send: (save: WaitingSave<P>) => Promise<Sent>) => Promise<void>;
  readonly retry: (opId: string) => Promise<void>;
  readonly discard: (opId: string) => Promise<void>;
  readonly clear: (goes?: (save: WaitingSave<P>) => boolean) => Promise<void>;
  readonly onChange: (listener: (saves: readonly WaitingSave<P>[]) => void) => () => void;
}

const settled = <P>(save: WaitingSave<P>, outcome: CallOutcome<unknown>) => {
  switch (outcome.kind) {
    case "landed":
    case "gone": {
      return null;
    }

    case "refused": {
      return { ...save, refused: outcome.message } satisfies WaitingSave<P> | null;
    }

    case "wait": {
      return save;
    }

    default: {
      throw new Error(`unexpected ${String(outcome satisfies never)}`);
    }
  }
};

const oldestFirst = (a: SaveStamp, b: SaveStamp) =>
  a.savedAt - b.savedAt || (a.opId < b.opId ? -1 : 1);

export const waitingSaves = <P>(args: {
  readonly storage: KvStorage;
  readonly prefix: string;
  readonly payload: z.ZodType<P>;
  readonly sameSave: (a: P, b: P) => boolean;
}) => {
  const { prefix, sameSave, storage } = args;

  const schema = z.object({
    id: z.uuidv7(),
    opId: z.uuidv7(),
    payload: args.payload,
    refused: z.string().nullable(),
    savedAt: z.number().int().nonnegative(),
  });

  const listeners = new Set<(saves: readonly WaitingSave<P>[]) => void>();
  const lock = serialLock();

  const keyOf = (opId: string) => `${prefix}${opId}`;

  const parsed = (text: string) => {
    try {
      return schema.parse(JSON.parse(text));
    } catch {
      return null;
    }
  };

  const read = async (key: string) => {
    const text = await storage.getItem(key);

    if (text === null) {
      return null;
    }

    const save = parsed(text);

    if (save === null) {
      await storage.removeItem(key);
    }

    return save;
  };

  const write = async (save: WaitingSave<P>) => {
    await storage.setItem(keyOf(save.opId), JSON.stringify(save));
  };

  const list = async () => {
    const saves: WaitingSave<P>[] = [];

    for (const key of await storage.getAllKeys()) {
      const save = key.startsWith(prefix) ? await read(key) : null;

      if (save !== null) {
        saves.push(save);
      }
    }

    return saves.toSorted(oldestFirst);
  };

  const change = async (step: () => Promise<boolean>) => {
    await lock(async () => {
      if ((await step()) && listeners.size > 0) {
        const saves = await list();

        for (const listener of listeners) {
          listener(saves);
        }
      }
    });
  };

  const remove = async (opId: string) => {
    await change(async () => {
      await storage.removeItem(keyOf(opId));

      return true;
    });
  };

  const settle: WaitingSaves<P>["settle"] = async (opId, outcome) => {
    await change(async () => {
      const save = await read(keyOf(opId));
      const next = save === null ? null : settled(save, outcome);

      if (next === save) {
        return false;
      }

      if (next === null) {
        await storage.removeItem(keyOf(opId));

        return true;
      }

      const saves = await list();

      const parked = saves.find(
        (kept) =>
          kept.refused !== null && kept.opId !== opId && sameSave(kept.payload, next.payload),
      );

      if (parked === undefined) {
        await write(next);
      } else {
        await storage.removeItem(keyOf(opId));
        await write({ ...parked, refused: next.refused });
      }

      return true;
    });
  };

  return {
    clear: async (goes = () => true) => {
      await change(async () => {
        for (const save of await list()) {
          if (goes(save)) {
            await storage.removeItem(keyOf(save.opId));
          }
        }

        return true;
      });
    },
    discard: remove,
    keep: async (stamp, payload) => {
      const save = {
        id: stamp.id,
        opId: stamp.opId,
        payload,
        refused: null,
        savedAt: stamp.savedAt,
      };

      await change(async () => {
        for (const kept of await list()) {
          if (kept.refused === null && sameSave(kept.payload, payload)) {
            await storage.removeItem(keyOf(kept.opId));
          }
        }

        await write(save);

        return true;
      });

      return save;
    },
    list,
    onChange: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    pass: async (send) => {
      for (const { opId } of await list()) {
        const save = await read(keyOf(opId));

        if (save === null || save.refused !== null) {
          continue;
        }

        const sent = await send(save);

        if (sent.kind === "skipped") {
          continue;
        }

        await settle(opId, sent);

        if (sent.kind === "wait" || sent.kind === "gone") {
          return;
        }
      }
    },
    retry: async (opId) => {
      await change(async () => {
        const save = await read(keyOf(opId));

        if (save === null || save.refused === null) {
          return false;
        }

        await write({ ...save, refused: null });

        return true;
      });
    },
    settle,
  } satisfies WaitingSaves<P>;
};

export const savesWaiting = (count: number) =>
  count === 1 ? "1 save waiting" : `${String(count)} saves waiting`;
