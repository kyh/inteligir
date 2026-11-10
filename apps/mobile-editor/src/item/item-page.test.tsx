import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getEditorHostActions, getEditorHostIo } from "@repo/editor/host-io";
import { MISSING_ITEM } from "@repo/editor/item/item-editor";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/refusal-text";
import { noteFields, paragraph } from "@repo/contract/test-support/library-items";

import { connectPageBridge } from "../bridge/page-bridge";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import type { FakePhone } from "../test-support/fake-phone";
import type { HeldItem } from "./item-host";
import { mountItemPage, PHONE_READS_ONLY } from "./item-page";
import type { MountedPage } from "./item-page";

const ITEM = "0190a000-0000-7000-8000-000000000001";
const OTHER = "0190a000-0000-7000-8000-000000000002";

const itemOf = (title: string, ...blocks: LibraryBlock[]): HeldItem => ({
  blocks: blocks.map((block) => ({ block, section: "note" })),
  fields: noteFields({ title }),
});

let mounted: MountedPage | null = null;

afterEach(() => {
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
  document.body.replaceChildren();
});

const openPage = async (phone: FakePhone) => {
  const connecting = connectPageBridge(phone.transport);
  phone.init({ itemId: ITEM });
  const { bridge, init } = await connecting;
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    mounted = mountItemPage({ bridge, container, itemId: init.itemId });
  });
};

const moved = (phone: FakePhone, ids: string[]) => {
  phone.deliver({ ids, nonce: PHONE_NONCE, reset: false, type: "itemChanged" });
};

describe("an item page over the blocks the phone holds", () => {
  it("draws the item read-only, under the phone's words for why", async () => {
    const phone = createFakePhone({
      [ITEM]: itemOf("Plans", paragraph("p1", "Hello from the item.")),
    });
    await openPage(phone);
    await expect(screen.findByText("Hello from the item.")).resolves.toBeDefined();
    expect(screen.getByText(PHONE_READS_ONLY)).toBeDefined();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("draws the item again when the phone says it moved, and only then", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf("Plans", paragraph("p1", "first")) });
    await openPage(phone);
    await expect(screen.findByText("first")).resolves.toBeDefined();
    const reads = phone.requests("item").length;
    phone.items.set(ITEM, itemOf("Plans", paragraph("p1", "from the Mac")));
    moved(phone, [OTHER]);
    await waitFor(() => {
      expect(phone.requests("linkTargets")).toHaveLength(2);
    });
    expect(phone.requests("item")).toHaveLength(reads);
    moved(phone, [ITEM]);
    await expect(screen.findByText("from the Mac")).resolves.toBeDefined();
  });

  it("says an item the phone has none of is gone", async () => {
    const phone = createFakePhone();
    await openPage(phone);
    await expect(screen.findByText(MISSING_ITEM)).resolves.toBeDefined();
  });

  it("says it needs a connection when the phone cannot read the item", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf("Plans", paragraph("p1", "first")) });
    phone.answer = () => ({ error: "offline", ok: false });
    await openPage(phone);
    await expect(screen.findByText(NEEDS_CONNECTION)).resolves.toBeDefined();
  });

  it("opens a linked item through the native stack, and draws an embed from the phone's blocks", async () => {
    const phone = createFakePhone({
      [ITEM]: itemOf("Plans", paragraph("p1", "first")),
      [OTHER]: itemOf("Other", paragraph("o1", "Pulled from the phone.")),
    });
    await openPage(phone);
    const io = getEditorHostIo();
    io.openItem(OTHER);
    expect(phone.events("openItem")).toStrictEqual([
      { itemId: OTHER, nonce: PHONE_NONCE, type: "openItem" },
    ]);
    await expect(io.readItemBlocks(OTHER)).resolves.toStrictEqual([
      paragraph("o1", "Pulled from the phone."),
    ]);
    await expect(io.readItemBlocks("0190a000-0000-7000-8000-00000000000f")).resolves.toBeNull();
  });

  it("reads a note's file from the phone, and takes no file or note of its own", async () => {
    const phone = createFakePhone({ [ITEM]: itemOf("Plans", paragraph("p1", "first")) });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const sha = "a".repeat(64);
    phone.files.set(sha, { base64: btoa(String.fromCodePoint(...png)), mediaType: "image/png" });
    await openPage(phone);
    const io = getEditorHostIo();
    const file = await io.readFile(sha);
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(png);
    await expect(io.readFile("f".repeat(64))).rejects.toThrow(/no copy/u);
    await expect(io.keepFile(png, "image/png")).rejects.toThrow(/no edit/u);
    await expect(
      getEditorHostActions().items.createNote({ blocks: [], title: "Moved" }),
    ).rejects.toThrow(/no edit/u);
    expect(io.notes.offline()).toBe(true);
  });
});
