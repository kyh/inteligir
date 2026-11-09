import { createORPCClient, createORPCErrorFromJson } from "@orpc/client";
import type { V1Client } from "@repo/contract/v1";
import type { ItemStoreChange } from "@repo/editor/item/item-session";
import { describe, expect, it } from "vitest";

import type { ItemsMoved } from "../cloud/use-library-socket";
import { heldItem } from "../test-support/cell-rows";
import { createCellItemStore } from "./cell-item-store";

const NOTE = "0199a4c2-0000-7000-8000-0000000000d1";

const refusal = (code: "CONFLICT" | "NOT_FOUND") =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

const nothing = (): void => {
  // the suite's socket closes nothing
};

// the store over a cell whose item stands at a sequence from `start`, and whose writes answer as
// `write` says, moving that sequence if it likes
const storeOver = (write: (seq: { now: number }) => object, start = 1) => {
  const seq = { now: start };
  const client = createORPCClient<V1Client>({
    call: async (path) => {
      const asked = path.join(".");
      if (asked === "library.items.get") {
        return await Promise.resolve(heldItem(NOTE, { title: "Plans" }, seq.now));
      }
      if (asked === "library.write") {
        return await Promise.resolve(write(seq));
      }
      throw new Error(`the suite answers no ${asked}`);
    },
  });
  const listeners: ((moved: ItemsMoved) => void)[] = [];
  const store = createCellItemStore(
    { client },
    {
      onItems: (listener) => {
        listeners.push(listener);
        return nothing;
      },
    },
  );
  const heard: ItemStoreChange[] = [];
  store.onChange((change) => {
    heard.push(change);
  });
  return {
    heard,
    moved: (moved: ItemsMoved) => {
      for (const listener of listeners) {
        listener(moved);
      }
    },
    store,
  };
};

const RETITLE = [{ base: "Plans", field: "title", op: "set", value: "Trip" }] as const;

describe("the open item's store over the cell", () => {
  it("hears another writer's move of the item, and not its own write's", async () => {
    const { heard, moved, store } = storeOver(() => ({ item: heldItem(NOTE, {}, 2) }));
    await store.item(NOTE);

    await expect(store.write(NOTE, { ops: RETITLE })).resolves.toStrictEqual({ kind: "queued" });
    moved(new Map([[NOTE, 2]]));
    expect(heard).toStrictEqual([]);

    moved(new Map([[NOTE, 3]]));
    expect(heard).toMatchObject([{ ids: new Set([NOTE]), reset: false }]);
  });

  it("hears nothing of a move it already read past", async () => {
    const { heard, moved, store } = storeOver(() => ({}), 5);
    await store.item(NOTE);

    moved(new Map([[NOTE, 4]]));

    expect(heard).toStrictEqual([]);
  });

  it("starts every item over when the socket opens again", () => {
    const { heard, moved } = storeOver(() => ({}));

    moved(null);

    expect(heard).toMatchObject([{ reset: true }]);
  });

  it("answers a conflict with the item as the cell holds it now, for the session to merge", async () => {
    const { store } = storeOver((seq) => {
      seq.now = 7;
      throw refusal("CONFLICT");
    });

    await expect(store.write(NOTE, { ops: RETITLE })).resolves.toMatchObject({
      item: { bodyHeld: true, fields: { title: "Plans" } },
      kind: "changed",
    });
  });

  it("answers an item the cell no longer holds as missing", async () => {
    const { store } = storeOver(() => {
      throw refusal("NOT_FOUND");
    });

    await expect(store.write(NOTE, { ops: RETITLE })).resolves.toStrictEqual({ kind: "missing" });
  });

  it("throws any other failure, so the session keeps the edit and tries again", async () => {
    const { store } = storeOver(() => {
      throw new TypeError("Failed to fetch");
    });

    await expect(store.write(NOTE, { ops: RETITLE })).rejects.toThrow("Failed to fetch");
  });
});
