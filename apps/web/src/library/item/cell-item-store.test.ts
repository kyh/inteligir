import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { ItemStoreChange } from "@repo/editor/item/item-session";
import { describe, expect, it } from "vitest";

import type { ItemsMoved } from "../cloud/use-library-socket";
import { createCellItemStore } from "./cell-item-store";

const nothing = (): void => {
  // the suite's socket closes nothing
};

// the store over the fake cell, through the page's device, with a note titled Plans
const storeOver = () => {
  const cell = createFakeCell();
  const id = cell.seed.item({ title: "Plans" });
  const page = cell.device("page");
  const listeners: ((moved: ItemsMoved) => void)[] = [];
  const store = createCellItemStore(
    { client: page.client },
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
    cell,
    heard,
    id,
    moved: (moved: ItemsMoved) => {
      for (const listener of listeners) {
        listener(moved);
      }
    },
    page,
    // another device's client on the same cell
    phone: cell.device("phone").client.library,
    store,
  };
};

const RETITLE = [{ base: "Plans", field: "title", op: "set", value: "Trip" }] as const;

describe("the open item's store over the cell", () => {
  it("hears another writer's move of the item, and not its own write's", async () => {
    const { cell, heard, id, moved, store } = storeOver();
    await store.item(id);

    await expect(store.write(id, { ops: RETITLE })).resolves.toStrictEqual({ kind: "queued" });
    const wrote = cell.held(id).seq;
    moved(new Map([[id, wrote]]));
    expect(heard).toStrictEqual([]);

    moved(new Map([[id, wrote + 1]]));
    expect(heard).toMatchObject([{ ids: new Set([id]), reset: false }]);
  });

  it("hears nothing of a move it already read past", async () => {
    const { cell, heard, id, moved, phone, store } = storeOver();
    const before = cell.held(id).seq;
    await phone.write({ itemId: id, ops: [...RETITLE] });
    await store.item(id);

    moved(new Map([[id, before]]));

    expect(heard).toStrictEqual([]);
  });

  it("starts every item over when the socket opens again", () => {
    const { heard, moved } = storeOver();

    moved(null);

    expect(heard).toMatchObject([{ reset: true }]);
  });

  it("answers a conflict with the item as the cell holds it now, for the session to merge", async () => {
    const { id, phone, store } = storeOver();
    await phone.write({
      itemId: id,
      ops: [{ base: "Plans", field: "title", op: "set", value: "Spring plans" }],
    });

    await expect(store.write(id, { ops: RETITLE })).resolves.toMatchObject({
      item: { bodyHeld: true, fields: { title: "Spring plans" } },
      kind: "changed",
    });
  });

  it("answers an item the cell no longer holds as missing", async () => {
    const { id, phone, store } = storeOver();
    await phone.items.delete({ ids: [id] });
    await phone.items.purge({ ids: [id] });

    await expect(store.write(id, { ops: RETITLE })).resolves.toStrictEqual({ kind: "missing" });
  });

  it("throws any other failure, so the session keeps the edit and tries again", async () => {
    const { id, page, store } = storeOver();
    page.setOffline(true);

    await expect(store.write(id, { ops: RETITLE })).rejects.toThrow("the network is down");
  });
});
