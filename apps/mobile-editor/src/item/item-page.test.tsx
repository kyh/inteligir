import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createItemSession, ITEM_IDLE_MS } from "@repo/editor/item/item-session";
import { headlessEditor } from "@repo/editor/markdown/markdown-doc";
import { blockHash } from "@repo/notes/library/block-hash";
import type { ItemState } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { noteFields } from "@repo/notes/test-support/library-items";

import { connectPageBridge } from "../bridge/page-bridge";
import type { MountedPage } from "../editor-page";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import type { FakePhone } from "../test-support/fake-phone";
import { bridgeItemStore } from "./item-host";
import { mountItemPage } from "./item-page";

const ITEM = "0190a000-0000-7000-8000-000000000001";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const itemOf = (...blocks: LibraryBlock[]): ItemState => ({
  blocks: new Map(
    blocks.map((block, index) => [
      block.id,
      { block, hash: blockHash(block), ord: `a${String(index)}`, section: "note" as const },
    ]),
  ),
  fields: noteFields({ title: "Plans" }),
});

const textAt = (phone: FakePhone, blockId: string): string | undefined => {
  const block = phone.items.get(ITEM)?.blocks.get(blockId)?.block;
  const [leaf] = block?.children ?? [];
  return leaf !== undefined && "text" in leaf ? leaf.text : undefined;
};

// a timer the case moves by hand, as the session's pause asks for one
const manualTimers = () => {
  let due: (() => void) | null = null;
  return {
    after: (_ms: number, run: () => void) => {
      due = run;
      return () => {
        due = null;
      };
    },
    fire: () => {
      const run = due;
      due = null;
      run?.();
    },
  };
};

const connectItem = async (phone: FakePhone) => {
  const connecting = connectPageBridge(phone.transport);
  phone.deliver({ focus: null, itemId: ITEM, mode: "item", nonce: PHONE_NONCE, type: "init" });
  const { bridge, init } = await connecting;
  if (init.mode !== "item") {
    throw new Error("the fake phone opened the page in another mode");
  }
  return { bridge, init };
};

const sessionOver = async (phone: FakePhone) => {
  const { bridge } = await connectItem(phone);
  const editor = headlessEditor();
  const timers = manualTimers();
  const overlaps: string[] = [];
  const session = createItemSession(ITEM, editor, {
    after: timers.after,
    idleMs: ITEM_IDLE_MS,
    notifyOverlap: (title) => {
      overlaps.push(title);
    },
    store: bridgeItemStore(bridge),
  });
  await session.start();
  return { editor, overlaps, session, timers };
};

let mounted: MountedPage | null = null;

afterEach(() => {
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
});

describe("an item page over the phone's replica", () => {
  it("reads the item, and lands a pause's edit on the phone as ops under their bases", async () => {
    const phone = createFakePhone({}, { [ITEM]: itemOf(paragraph("p1", "first")) });
    const { editor, session, timers } = await sessionOver(phone);
    expect(phone.requests("item")).toHaveLength(1);
    editor.tf.insertText(" words", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    expect(phone.requests("writeItem")).toHaveLength(0);
    timers.fire();
    await session.flush();
    const [write] = phone.requests("writeItem");
    expect(write?.payload.ops).toEqual([
      {
        baseHash: blockHash(paragraph("p1", "first")),
        block: paragraph("p1", "first words"),
        op: "put",
      },
    ]);
    expect(textAt(phone, "p1")).toBe("first words");
  });

  it("settles a write the phone finds changed under it, and writes again over what it holds", async () => {
    const phone = createFakePhone(
      {},
      { [ITEM]: itemOf(paragraph("p1", "first"), paragraph("p2", "x")) },
    );
    const { editor, overlaps, session, timers } = await sessionOver(phone);
    phone.items.set(
      ITEM,
      itemOf(paragraph("p1", "first, from the Mac"), paragraph("p2", "from the Mac")),
    );
    editor.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    timers.fire();
    await session.flush();
    const writes = phone.requests("writeItem");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.payload.ops).toMatchObject([
      { baseHash: blockHash(paragraph("p1", "first, from the Mac")), op: "put" },
    ]);
    expect(textAt(phone, "p1")).toBe("first!");
    expect(editor.children).toMatchObject([
      { children: [{ text: "first!" }], id: "p1" },
      { children: [{ text: "from the Mac" }], id: "p2" },
    ]);
    expect(overlaps).toEqual(["Plans"]);
  });

  it("says a merge the phone made kept this page's lines over the other device's", async () => {
    const phone = createFakePhone({}, { [ITEM]: itemOf(paragraph("p1", "first")) });
    const { overlaps } = await sessionOver(phone);
    phone.deliver({
      ids: [ITEM],
      nonce: PHONE_NONCE,
      overlapped: [ITEM],
      reset: false,
      type: "itemChanged",
    });
    await waitFor(() => {
      expect(overlaps).toEqual(["Plans"]);
    });
  });

  it("reads the item again when the phone says it changed", async () => {
    const phone = createFakePhone({}, { [ITEM]: itemOf(paragraph("p1", "first")) });
    const { editor, session } = await sessionOver(phone);
    phone.items.set(ITEM, itemOf(paragraph("p1", "from the Mac")));
    phone.deliver({
      ids: [ITEM],
      nonce: PHONE_NONCE,
      overlapped: [],
      reset: false,
      type: "itemChanged",
    });
    await waitFor(() => {
      expect(phone.requests("item")).toHaveLength(2);
    });
    await session.flush();
    expect(editor.children[0]).toMatchObject({ children: [{ text: "from the Mac" }] });
  });

  it("draws the item it was opened on, and answers a flush once it is written", async () => {
    const phone = createFakePhone({}, { [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    expect(await screen.findByText("Hello from the item.")).toBeDefined();
    phone.deliver({ id: 4, nonce: PHONE_NONCE, type: "flush" });
    await waitFor(() => {
      expect(phone.events("flushed")).toMatchObject([{ id: 4, ok: true }]);
    });
  });
});
