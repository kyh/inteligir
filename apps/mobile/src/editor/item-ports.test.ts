import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { blockHash } from "@repo/notes/library/block-hash";
import { describe, expect, it } from "vitest";
import { createItemPorts } from "./item-ports";

const NOW = 1_700_000_300_000;

// a phone holding one landed note of one paragraph
const phoneWithNote = async () => {
  const cell = createFakeCell();
  const phone = await openDevice(cell, "phone");
  const made = await phone.replica.createNote({
    blocks: [{ block: paragraph("p1", "first"), ord: "a0", section: "note" }],
    folderId: null,
    tags: [],
    title: "Plans",
  });
  await phone.replica.sync();
  const ports = createItemPorts({ now: () => NOW, replica: phone.replica });
  return { cell, id: made.id, phone, ports };
};

describe("an item page's questions, answered from the phone's replica", () => {
  it("reads the item as the replica holds it, and none for an item it lacks", async () => {
    const { id, ports } = await phoneWithNote();
    const { item } = await ports.item({ itemId: id });
    expect(item).toMatchObject({ bodyHeld: true, fields: { title: "Plans" } });
    expect(item?.blocks.map(({ block }) => block.id)).toEqual(["p1"]);
    expect(await ports.item({ itemId: "0190a000-0000-7000-8000-00000000dead" })).toStrictEqual({
      item: null,
    });
  });

  it("queues a pause's ops under their bases, and answers a moved base with the item as it is", async () => {
    const { cell, id, phone, ports } = await phoneWithNote();
    const base = blockHash(paragraph("p1", "first"));
    expect(
      await ports.writeItem({
        files: [],
        itemId: id,
        ops: [{ baseHash: base, block: paragraph("p1", "first, edited"), op: "put" }],
      }),
    ).toStrictEqual({ kind: "queued" });
    const stale = await ports.writeItem({
      files: [],
      itemId: id,
      ops: [{ baseHash: base, block: paragraph("p1", "again"), op: "put" }],
    });
    expect(stale).toMatchObject({ kind: "changed" });
    await phone.replica.sync();
    expect(cell.item(id)?.blocks.get("p1")?.block).toMatchObject({
      children: [{ text: "first, edited" }],
    });
  });

  it("names every item a link can open, by id and by title", async () => {
    const { id, ports } = await phoneWithNote();
    expect(await ports.wikiTargets({})).toStrictEqual({
      targets: [{ id, path: "Plans.md", title: "Plans", type: "doc" }],
    });
  });

  it("writes a highlight's bare entry and then its note, as the library's page does", async () => {
    const { cell, id, phone, ports } = await phoneWithNote();
    expect(await ports.addHighlight({ id: "h1", itemId: id, quote: "first" })).toStrictEqual({
      queued: true,
    });
    expect(await ports.noteHighlight({ id: "h1", itemId: id, text: "why?" })).toStrictEqual({
      queued: true,
    });
    expect(await ports.noteHighlight({ id: "h2", itemId: id, text: "none" })).toStrictEqual({
      queued: false,
    });
    await phone.replica.sync();
    expect(cell.annotation("h1")).toMatchObject({ quote: "first", text: "why?" });
  });
});
