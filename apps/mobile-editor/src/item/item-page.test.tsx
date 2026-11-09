import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, test } from "vitest";

import { getEditorHostActions, getEditorHostIo } from "@repo/editor/host-io";
import {
  BLOCK_HELD_BACK,
  BODY_TO_COME,
  createItemSession,
  ITEM_UNSAVED,
} from "@repo/editor/item/item-session";
import { getLiveEditor } from "@repo/editor/live-editor";
import { headlessEditor } from "@repo/editor/markdown/markdown-doc";
import { blockHash } from "@repo/contract/library/block-hash";
import type { ItemState } from "@repo/contract/library/block-ops";
import { BLOCK_MAX_BYTES } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/refusal-text";
import { noteFields } from "@repo/contract/test-support/library-items";

import { connectPageBridge } from "../bridge/page-bridge";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import type { FakePhone } from "../test-support/fake-phone";
import { bridgeItemStore } from "./item-host";
import { ItemPage, mountItemPage } from "./item-page";
import type { MountedPage } from "./item-page";

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

const connectItem = async (phone: FakePhone, online = true) => {
  const connecting = connectPageBridge(phone.transport);
  phone.deliver({
    fileMaxBytes: 1024,
    focus: null,
    itemId: ITEM,
    nonce: PHONE_NONCE,
    online,
    type: "init",
  });
  return await connecting;
};

const sessionOver = async (phone: FakePhone) => {
  const { bridge } = await connectItem(phone);
  const editor = headlessEditor();
  const timers = manualTimers();
  const overlaps: string[] = [];
  const session = createItemSession(ITEM, editor, {
    after: timers.after,
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

describe("an item page over the library the phone reaches", () => {
  it("reads the item, and lands a pause's edit on the phone as ops under their bases", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "first")) });
    const { editor, session, timers } = await sessionOver(phone);
    expect(phone.requests("item")).toHaveLength(1);
    editor.tf.insertText(" words", { at: { offset: 5, path: [0, 0] } });
    session.edited();
    expect(phone.requests("writeItem")).toHaveLength(0);
    timers.fire();
    await session.flush();
    const [write] = phone.requests("writeItem");
    expect(write?.payload.ops).toStrictEqual([
      {
        baseHash: blockHash(paragraph("p1", "first")),
        block: paragraph("p1", "first words"),
        op: "put",
      },
    ]);
    expect(textAt(phone, "p1")).toBe("first words");
  });

  it("settles a write the phone finds changed under it, and writes again over what it holds", async () => {
    const phone = createFakePhone({
      [ITEM]: itemOf(paragraph("p1", "first"), paragraph("p2", "x")),
    });
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
    expect(overlaps).toStrictEqual(["Plans"]);
  });

  it("says a merge the phone made kept this page's lines over the other device's", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "first")) });
    const { overlaps } = await sessionOver(phone);
    phone.deliver({
      ids: [ITEM],
      nonce: PHONE_NONCE,
      overlapped: [ITEM],
      reset: false,
      type: "itemChanged",
    });
    await waitFor(() => {
      expect(overlaps).toStrictEqual(["Plans"]);
    });
  });

  it("reads the item again when the phone says it changed", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "first")) });
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

  it("makes a note through the phone beside its item, and reads the links' targets again as the library moves", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "first")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await waitFor(() => {
      expect(phone.requests("linkTargets")).toHaveLength(1);
    });

    const id = await getEditorHostActions().items.createNote({
      blocks: [{ block: paragraph("n1", "moved"), ord: "a0" }],
      title: "Moved",
    });
    expect(phone.requests("createNote").map(({ payload }) => payload)).toStrictEqual([
      { besideId: ITEM, blocks: [{ block: paragraph("n1", "moved"), ord: "a0" }], title: "Moved" },
    ]);
    expect(phone.items.get(id)?.fields.title).toBe("Moved");

    // this item's own write names nothing a link reaches; another item's does
    phone.deliver({
      ids: [ITEM],
      nonce: PHONE_NONCE,
      overlapped: [],
      reset: false,
      type: "itemChanged",
    });
    phone.deliver({
      ids: [id],
      nonce: PHONE_NONCE,
      overlapped: [],
      reset: false,
      type: "itemChanged",
    });
    await waitFor(() => {
      expect(phone.requests("linkTargets")).toHaveLength(2);
    });
  });

  it("reads a note's file from the phone, keeps a pasted one there, and holds a paste to the phone's cap", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "first")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    const io = getEditorHostIo();
    expect(io.fileMaxBytes).toBe(1024);
    expect(io.savesFiles).toBe(false);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { sha } = await io.keepFile(png, "image/png");
    expect(phone.requests("keepFile").map(({ payload }) => payload)).toStrictEqual([
      { base64: btoa(String.fromCodePoint(...png)), mediaType: "image/png" },
    ]);
    const file = await io.readFile(sha);
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(png);
    await expect(io.readFile("f".repeat(64))).rejects.toThrow(/no copy/u);
  });

  it("answers an embedded item's blocks only once the phone holds its body", async () => {
    const other = "0190a000-0000-7000-8000-000000000002";
    const phone = createFakePhone({
      [ITEM]: itemOf(paragraph("p1", "first")),
      [other]: itemOf(paragraph("o1", "Pulled at last.")),
    });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    const io = getEditorHostIo();
    await expect(io.readItemBlocks(other)).resolves.toStrictEqual([
      paragraph("o1", "Pulled at last."),
    ]);

    // the phone has the item's row, and its body is still to come
    const library = phone.answer;
    phone.answer = (request) =>
      request.kind === "item" && request.payload.itemId === other
        ? {
            ok: true,
            result: {
              item: { blocks: [], bodyHeld: false, fields: noteFields({ title: "Other" }) },
            },
          }
        : library(request);
    await expect(io.readItemBlocks(other)).resolves.toBeNull();
  });

  it("draws the item it was opened on, and answers a flush once it is written", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await expect(screen.findByText("Hello from the item.")).resolves.toBeDefined();
    phone.deliver({ id: 4, nonce: PHONE_NONCE, type: "flush" });
    await waitFor(() => {
      expect(phone.events("flushed")).toMatchObject([{ id: 4, ok: true }]);
    });
  });

  it("answers a flush that failed while the phone rejects the write, in the person's words", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await expect(screen.findByText("Hello from the item.")).resolves.toBeDefined();
    const library = phone.answer;
    phone.answer = (request) =>
      request.kind === "writeItem" ? { error: "SQLITE_FULL", ok: false } : library(request);
    act(() => {
      getLiveEditor(ITEM)?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    });
    phone.deliver({ id: 4, nonce: PHONE_NONCE, type: "flush" });
    await waitFor(() => {
      expect(phone.events("flushed")).toMatchObject([{ id: 4, ok: false }]);
    });
    expect(phone.events("editorState").at(-1)).toMatchObject({
      saveError: ITEM_UNSAVED,
    });
  });

  it("holds a leave while the phone waits on the item's body, in the person's words", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await expect(screen.findByText("Hello from the item.")).resolves.toBeDefined();
    const library = phone.answer;
    phone.answer = (request) =>
      request.kind === "writeItem" ? { ok: true, result: { kind: "waiting" } } : library(request);
    act(() => {
      getLiveEditor(ITEM)?.tf.insertText("!", { at: { offset: 5, path: [0, 0] } });
    });
    phone.deliver({ id: 4, nonce: PHONE_NONCE, type: "flush" });
    await waitFor(() => {
      expect(phone.events("flushed")).toMatchObject([{ id: 4, ok: false }]);
    });
    expect(phone.events("editorState").at(-1)).toMatchObject({ saveError: BODY_TO_COME });
  });

  it("only reads while the phone has no connection, and takes edits once it says one is back", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone, false);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await expect(screen.findByText(NEEDS_CONNECTION)).resolves.toBeDefined();
    act(() => {
      phone.deliver({ nonce: PHONE_NONCE, online: true, type: "connection" });
    });
    await waitFor(() => {
      expect(screen.queryByText(NEEDS_CONNECTION)).toBeNull();
    });
    act(() => {
      phone.deliver({ nonce: PHONE_NONCE, online: false, type: "connection" });
    });
    await expect(screen.findByText(NEEDS_CONNECTION)).resolves.toBeDefined();
  });

  it("tells the phone a block no write can store is unsaved, and answers a flush that it failed", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf(paragraph("p1", "Hello from the item.")) });
    const { bridge, init } = await connectItem(phone);
    const container = document.createElement("div");
    document.body.append(container);
    act(() => {
      mounted = mountItemPage({ bridge, container, init });
    });
    await expect(screen.findByText("Hello from the item.")).resolves.toBeDefined();
    act(() => {
      getLiveEditor(ITEM)?.tf.insertText("y".repeat(BLOCK_MAX_BYTES), {
        at: { offset: 5, path: [0, 0] },
      });
    });
    phone.deliver({ id: 4, nonce: PHONE_NONCE, type: "flush" });
    await waitFor(() => {
      expect(phone.events("flushed")).toMatchObject([{ id: 4, ok: false }]);
    });
    expect(phone.events("editorState").at(-1)).toMatchObject({
      saveError: BLOCK_HELD_BACK,
    });
    expect(screen.getByRole("alert").textContent).toBe(BLOCK_HELD_BACK);
  });
});

// a component the compiler memoizes wrongly passes every other test and fails only on the phone
test("holds the React Compiler's output for the page's components", () => {
  expect(
    ItemPage.toString(),
    "the mobile-editor vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/",
  ).toContain("react.memo_cache_sentinel");
});
