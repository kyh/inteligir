// A waiting save: a save a device keeps before its first call and sends until the cloud answers
// it, through a relaunch too. Each is one key of the host's key-value store, holding what the host
// sends and the ids minted for it, so a resend after a lost answer lands once. The store is read at
// every step, so nothing rests on what a stopped worker or a closed app held in memory. A pass
// sends the oldest first: one that lands goes, one the cloud cannot answer yet stops the pass for
// the next, one no resend can land is parked with the library's words until the person sends it
// again or lets it go, and one whose account is deleted goes. Every change is one step at a time,
// so a try's answer never brings back a save let go while its call was on its way.

import type { CallOutcome } from "@repo/contract/rpc/call-outcome";
import { z } from "zod";

import { serialLock } from "./serial-lock";

// the host's key-value store, as AsyncStorage spells it
export interface KvStorage {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
  readonly getAllKeys: () => Promise<readonly string[]>;
}

// the item's id and the write's op id, both minted once before the first call, and when
export interface SaveStamp {
  readonly id: string;
  readonly opId: string;
  readonly savedAt: number;
}

export interface WaitingSave<P> extends SaveStamp {
  // the library's words for why no resend lands it as it is; null while it waits to be sent
  readonly refused: string | null;
  // what the host sends of it
  readonly payload: P;
}

// what a pass's send answers of one save: its call's outcome, or that this pass leaves it be
type Sent = CallOutcome<unknown> | { readonly kind: "skipped" };

interface WaitingSaves<P> {
  // every save kept, oldest first, the parked among them
  readonly list: () => Promise<readonly WaitingSave<P>[]>;
  // kept before its first call goes
  readonly keep: (stamp: SaveStamp, payload: P) => Promise<WaitingSave<P>>;
  // what a try's outcome makes of its save, for a try the host made outside a pass
  readonly settle: (opId: string, outcome: CallOutcome<unknown>) => Promise<void>;
  // every save that waits, sent oldest first until one cannot go yet; the host runs one pass at a
  // time (`oneAtATime`)
  readonly pass: (send: (save: WaitingSave<P>) => Promise<Sent>) => Promise<void>;
  // a parked save waits to be sent again
  readonly retry: (opId: string) => Promise<void>;
  readonly discard: (opId: string) => Promise<void>;
  // every save `goes` names, all of them where it names none
  readonly clear: (goes?: (save: WaitingSave<P>) => boolean) => Promise<void>;
  // told what is kept after each change
  readonly onChange: (listener: (saves: readonly WaitingSave<P>[]) => void) => () => void;
}

// what a try's outcome makes of the save it carried: null once the queue keeps it no longer
const settled = <P>(save: WaitingSave<P>, outcome: CallOutcome<unknown>): WaitingSave<P> | null => {
  switch (outcome.kind) {
    case "landed":
    case "gone": {
      return null;
    }
    case "refused": {
      return { ...save, refused: outcome.message };
    }
    case "wait": {
      return save;
    }
    // no default
  }
};

const oldestFirst = (a: SaveStamp, b: SaveStamp): number =>
  a.savedAt - b.savedAt || (a.opId < b.opId ? -1 : 1);

export const waitingSaves = <P>(args: {
  readonly storage: KvStorage;
  // what every save's key starts with, its op id after it
  readonly prefix: string;
  readonly payload: z.ZodType<P>;
}): WaitingSaves<P> => {
  const { prefix, storage } = args;
  const schema = z.object({
    id: z.uuidv7(),
    opId: z.uuidv7(),
    payload: args.payload,
    refused: z.string().nullable(),
    savedAt: z.number().int().nonnegative(),
  });
  const listeners = new Set<(saves: readonly WaitingSave<P>[]) => void>();
  const lock = serialLock();

  const keyOf = (opId: string): string => `${prefix}${opId}`;

  const parsed = (text: string): WaitingSave<P> | null => {
    try {
      return schema.parse(JSON.parse(text));
    } catch {
      return null;
    }
  };

  // the save under a key, or null for none; a record this build cannot read is no save, and goes
  const read = async (key: string): Promise<WaitingSave<P> | null> => {
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

  const write = async (save: WaitingSave<P>): Promise<void> => {
    await storage.setItem(keyOf(save.opId), JSON.stringify(save));
  };

  const list = async (): Promise<WaitingSave<P>[]> => {
    const saves: WaitingSave<P>[] = [];
    for (const key of await storage.getAllKeys()) {
      const save = key.startsWith(prefix) ? await read(key) : null;
      if (save !== null) {
        saves.push(save);
      }
    }
    return saves.toSorted(oldestFirst);
  };

  // one change at a time: `step` answers whether it moved anything, and whoever listens is told
  // what is kept after one that did
  const change = async (step: () => Promise<boolean>): Promise<void> => {
    await lock(async () => {
      if ((await step()) && listeners.size > 0) {
        const saves = await list();
        for (const listener of listeners) {
          listener(saves);
        }
      }
    });
  };

  const remove = async (opId: string): Promise<void> => {
    await change(async () => {
      await storage.removeItem(keyOf(opId));
      return true;
    });
  };

  // a save let go while its call was on its way stays gone, and one that waits stays as kept
  const settle: WaitingSaves<P>["settle"] = async (opId, outcome) => {
    await change(async () => {
      const save = await read(keyOf(opId));
      const next = save === null ? null : settled(save, outcome);
      if (next === save) {
        return false;
      }
      await (next === null ? storage.removeItem(keyOf(opId)) : write(next));
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
        // read at its turn: one let go or parked while the pass ran is not sent
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
  };
};

// One pass at a time: an ask while a pass runs asks for one more after it, so what changed
// mid-pass is read again and no two passes send one save. The run lives as long as its host, which
// loses nothing it needs later with it.
type Pass = { readonly kind: "idle" } | { readonly kind: "running"; readonly again: boolean };

const passAfter = (pass: Pass, event: "asked" | "finished" | "failed"): Pass => {
  switch (event) {
    case "asked": {
      return { again: pass.kind === "running", kind: "running" };
    }
    case "finished": {
      return pass.kind === "running" && pass.again
        ? { again: false, kind: "running" }
        : { kind: "idle" };
    }
    // a storage fault: the next ask starts over
    case "failed": {
      return { kind: "idle" };
    }
    // no default
  }
};

// `run` behind that rule: an ask settles once a pass that started after it has run, each pass
// given what the ask that started the run was
export const oneAtATime = <A extends readonly unknown[]>(
  run: (...args: A) => Promise<void>,
): ((...args: A) => Promise<void>) => {
  let pass: Pass = { kind: "idle" };
  let drained: Promise<void> = Promise.resolve();

  const drain = async (args: A): Promise<void> => {
    do {
      try {
        await run(...args);
      } catch (error) {
        pass = passAfter(pass, "failed");
        throw error;
      }
      pass = passAfter(pass, "finished");
    } while (pass.kind === "running");
  };

  return async (...args) => {
    const starts = pass.kind === "idle";
    pass = passAfter(pass, "asked");
    if (starts) {
      drained = drain(args);
    }
    await drained;
  };
};
